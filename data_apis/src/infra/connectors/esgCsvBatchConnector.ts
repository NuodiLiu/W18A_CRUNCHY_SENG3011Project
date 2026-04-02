import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { parse as csvParse } from "csv-parse";
import { Readable } from "node:stream";
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
      if (options?.startByte != null && options.startByte > 0) {
        await this.streamChunk(bucket, key, objKey, delimiter, hasHeader, onBatch, options.startByte, options.endByte);
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

  // stream an entire S3 CSV object from the beginning
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

  // stream a byte-range chunk of an S3 CSV object.
  // fetches the header row separately then reads data from startByte.
  // reads past endByte until the current CSV row completes (row-boundary alignment).
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
    // get the header row from the start of the file
    let headerLine: string | undefined;
    if (hasHeader) {
      const headRes = await this.s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: key, Range: "bytes=0-8191" })
      );
      const buf = await streamToBuffer(headRes.Body as Readable);
      const nl = buf.indexOf(0x0a);
      headerLine = buf.subarray(0, nl >= 0 ? nl : buf.length).toString("utf-8").trim();
    }

    // fetch the data chunk. read a bit past endByte to capture the last partial row.
    const overshoot = endByte ? endByte + 10_000 : undefined;
    const range = overshoot ? `bytes=${startByte}-${overshoot}` : `bytes=${startByte}-`;
    const res = await this.s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key, Range: range })
    );

    const rawBuf = await streamToBuffer(res.Body as Readable);

    // trim: find the first newline (skip partial leading row) and last newline
    let dataStart = 0;
    if (startByte > 0) {
      // the chunk may start mid-row; skip to the first complete row
      const firstNl = rawBuf.indexOf(0x0a);
      if (firstNl >= 0) dataStart = firstNl + 1;
    }

    let dataEnd = rawBuf.length;
    if (endByte && overshoot) {
      // find the last newline within the original endByte boundary + overshoot
      // to get a complete row
      const targetLen = endByte - startByte;
      // find the first newline at or after the target boundary
      const searchStart = Math.max(targetLen, 0);
      const nlAfterTarget = rawBuf.indexOf(0x0a, searchStart);
      if (nlAfterTarget >= 0) dataEnd = nlAfterTarget + 1;
    }

    const dataSlice = rawBuf.subarray(dataStart, dataEnd);
    if (dataSlice.length === 0) return;

    // prepend header and parse
    const csvInput = headerLine
      ? Buffer.concat([Buffer.from(headerLine + "\n"), dataSlice])
      : dataSlice;

    const parser = csvParse({
      delimiter,
      columns: hasHeader ? true : false,
      skip_empty_lines: true,
      relax_column_count: true,
    });

    const stream = Readable.from(csvInput);
    stream.pipe(parser);
    await this.consumeParser(parser, objKey, onBatch);
  }

  // consume csv-parse output in batches
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

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
