import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { parse as csvParse } from "csv-parse";
import { Readable, Transform, TransformCallback } from "node:stream";
import {
  Connector,
  FetchOptions,
  RawRecord,
} from "../../domain/ports/connector.js";
import { ConnectorState } from "../../domain/models/connectorState.js";
import { SourceSpec } from "../../domain/models/jobConfig.js";
import { AppConfig } from "../../config/index.js";
import { UnprocessableError } from "../../domain/errors.js";

const BATCH_SIZE = 10_000;

export class EsgCsvBatchConnector implements Connector {
  private readonly s3: S3Client;

  constructor(config: AppConfig) {
    this.s3 = new S3Client({
      region: config.region,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      ...(config.s3Endpoint && {
        endpoint: config.s3Endpoint,
        forcePathStyle: true,
      }),
    });
  }

  async fetchIncremental(
    sourceSpec: SourceSpec,
    prevState: ConnectorState | undefined,
    onBatch: (batch: RawRecord[]) => Promise<void>,
    options?: FetchOptions,
  ): Promise<Partial<ConnectorState>> {
    const objectKeys = await this.resolveObjectKeys(sourceSpec);

    const filteredKeys =
      prevState?.last_processed_object_key
        ? objectKeys.filter((k) => k > prevState.last_processed_object_key!)
        : objectKeys;

    const delimiter = sourceSpec.delimiter ?? ",";
    const hasHeader = sourceSpec.has_header ?? true;
    let lastKey: string | undefined;

    for (const objKey of filteredKeys) {
      const { bucket, key } = this.parseS3Uri(objKey);
      if (options?.endByte != null) {
        await this.streamChunk(bucket, key, objKey, delimiter, hasHeader, onBatch, options.startByte ?? 0, options.endByte);
      } else {
        await this.streamFull(bucket, key, objKey, delimiter, hasHeader, onBatch);
      }
      lastKey = objKey;
    }

    return {
      ...(lastKey && { last_processed_object_key: lastKey }),
      updated_at: new Date().toISOString(),
    };
  }

  private async resolveObjectKeys(spec: SourceSpec): Promise<string[]> {
    if (spec.s3_uris && spec.s3_uris.length > 0) {
      return spec.s3_uris;
    }

    if (spec.s3_prefix) {
      const { bucket, key: prefix } = this.parseS3Uri(spec.s3_prefix);
      const keys: string[] = [];
      let continuationToken: string | undefined;

      do {
        const res = await this.s3.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          })
        );

        for (const obj of res.Contents ?? []) {
          if (obj.Key && obj.Key.endsWith(".csv")) {
            keys.push(`s3://${bucket}/${obj.Key}`);
          }
        }
        continuationToken = res.NextContinuationToken;
      } while (continuationToken);

      return keys.sort();
    }

    throw new UnprocessableError("source_spec must provide either s3_uris or s3_prefix");
  }

  // stream an entire S3 CSV object
  private async streamFull(
    bucket: string,
    key: string,
    objKey: string,
    delimiter: string,
    hasHeader: boolean,
    onBatch: (batch: RawRecord[]) => Promise<void>,
  ): Promise<void> {
    const res = await this.s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );

    const parser = csvParse({
      delimiter,
      columns: hasHeader ? true : false,
      skip_empty_lines: true,
      relax_column_count: true,
    });

    (res.Body as Readable).pipe(parser);
    await this.consumeParser(parser, objKey, onBatch);
  }

  // stream a byte-range chunk. fully streaming — no buffering the whole chunk.
  // 1. fetches header (first 8KB) to get column names
  // 2. streams from startByte, skipping the first partial row
  // 3. stops after endByte at the next row boundary
  private async streamChunk(
    bucket: string,
    key: string,
    objKey: string,
    delimiter: string,
    hasHeader: boolean,
    onBatch: (batch: RawRecord[]) => Promise<void>,
    startByte: number,
    endByte?: number,
  ): Promise<void> {
    // get the header row
    let headerLine: string | undefined;
    if (hasHeader) {
      const headRes = await this.s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: key, Range: "bytes=0-8191" })
      );
      const buf = await streamToBuffer(headRes.Body as Readable);
      const nl = buf.indexOf(0x0a);
      headerLine = buf.subarray(0, nl >= 0 ? nl : buf.length).toString("utf-8").trim();
    }

    // stream the chunk data with overshoot to capture the last partial row
    const rangeEnd = endByte ? endByte + 10_000 : undefined;
    const range = rangeEnd ? `bytes=${startByte}-${rangeEnd}` : `bytes=${startByte}-`;
    const res = await this.s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key, Range: range })
    );

    // transform stream: skip leading partial row (or header row for chunk 0), stop at endByte boundary
    const skipLeading = hasHeader || startByte > 0;
    const chunkBytesTarget = endByte ? endByte - startByte : undefined;
    const trimmer = new ChunkTrimmer(skipLeading, chunkBytesTarget);

    const parser = csvParse({
      delimiter,
      columns: hasHeader ? true : false,
      skip_empty_lines: true,
      relax_column_count: true,
    });

    // pipe: prepend header -> trim boundaries -> csv parse
    if (headerLine) {
      const headerBuf = Buffer.from(headerLine + "\n");
      // push header directly into parser, then pipe trimmed data
      parser.write(headerBuf);
    }

    (res.Body as Readable).pipe(trimmer).pipe(parser);
    await this.consumeParser(parser, objKey, onBatch);
  }

  private async consumeParser(
    parser: AsyncIterable<Record<string, string>>,
    objKey: string,
    onBatch: (batch: RawRecord[]) => Promise<void>,
  ): Promise<void> {
    let batch: RawRecord[] = [];
    let rowNumber = 0;

    for await (const record of parser as AsyncIterable<Record<string, string>>) {
      rowNumber++;
      batch.push({ raw_row: record, source_file: objKey, row_number: rowNumber });

      if (batch.length >= BATCH_SIZE) {
        await onBatch(batch);
        batch = [];
      }
    }

    if (batch.length > 0) {
      await onBatch(batch);
    }
  }

  private parseS3Uri(uri: string): { bucket: string; key: string } {
    const match = uri.match(/^s3:\/\/([^/]+)\/(.+)$/);
    if (!match) throw new Error(`Invalid S3 URI: ${uri}`);
    return { bucket: match[1], key: match[2] };
  }
}

// streaming transform that handles chunk boundary alignment:
// - if skipLeadingPartial is true, drops bytes until the first newline
// - after bytesTarget bytes have passed, emits up to the next newline then ends
class ChunkTrimmer extends Transform {
  private skippedLeading: boolean;
  private bytesEmitted = 0;
  private readonly skipLeading: boolean;
  private readonly target: number | undefined;
  private done = false;

  constructor(skipLeadingPartial: boolean, bytesTarget?: number) {
    super();
    this.skipLeading = skipLeadingPartial;
    this.skippedLeading = !skipLeadingPartial;
    this.target = bytesTarget;
  }

  _transform(chunk: Buffer, _encoding: string, cb: TransformCallback) {
    if (this.done) { cb(); return; }

    let data = chunk;

    // skip the leading partial row
    if (!this.skippedLeading) {
      const nl = data.indexOf(0x0a);
      if (nl < 0) { cb(); return; } // entire chunk is part of the partial row
      data = data.subarray(nl + 1);
      this.skippedLeading = true;
    }

    // if no target, emit everything
    if (this.target == null) {
      this.push(data);
      cb();
      return;
    }

    // check if we've passed the target boundary
    const remaining = this.target - this.bytesEmitted;
    if (remaining <= 0) {
      // already past target, find the next newline and stop
      const nl = data.indexOf(0x0a);
      if (nl >= 0) {
        this.push(data.subarray(0, nl + 1));
        this.done = true;
      }
      // else: no newline yet, keep going to find one
      cb();
      return;
    }

    if (data.length <= remaining) {
      this.push(data);
      this.bytesEmitted += data.length;
      cb();
      return;
    }

    // this chunk crosses the target boundary
    // emit up to target, then find the next newline
    const nl = data.indexOf(0x0a, remaining);
    if (nl >= 0) {
      this.push(data.subarray(0, nl + 1));
      this.done = true;
    } else {
      this.push(data);
      this.bytesEmitted += data.length;
    }
    cb();
  }
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
