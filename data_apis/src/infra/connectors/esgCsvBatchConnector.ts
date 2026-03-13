import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { parse as csvParse } from "csv-parse";
import { Readable } from "node:stream";
import {
  Connector,
  RawRecord,
} from "../../domain/ports/connector.js";
import { ConnectorState } from "../../domain/models/connectorState.js";
import { SourceSpec } from "../../domain/models/jobConfig.js";
import { AppConfig } from "../../config/index.js";
import { UnprocessableError } from "../../domain/errors.js";

// Number of CSV rows yielded per batch to the caller.
const BATCH_SIZE = 5_000;

export class EsgCsvBatchConnector implements Connector {
  private readonly s3: S3Client;

  constructor(config: AppConfig) {
    this.s3 = new S3Client({
      region: config.region,
      ...(config.s3Endpoint && {
        endpoint: config.s3Endpoint,
        forcePathStyle: true,
      }),
    });
  }

  async fetchIncremental(
    sourceSpec: SourceSpec,
    prevState: ConnectorState | undefined,
    onBatch: (batch: RawRecord[]) => Promise<void>
  ): Promise<Partial<ConnectorState>> {
    const objectKeys = await this.resolveObjectKeys(sourceSpec);

    // TODO: For incremental mode, filter out objects already processed
    //       using prevState.last_processed_object_key. Currently processes all.
    const filteredKeys =
      prevState?.last_processed_object_key
        ? objectKeys.filter((k) => k > prevState.last_processed_object_key!)
        : objectKeys;

    const delimiter = sourceSpec.delimiter ?? ",";
    const hasHeader = sourceSpec.has_header ?? true;
    let lastKey: string | undefined;

    for (const objKey of filteredKeys) {
      const { bucket, key } = this.parseS3Uri(objKey);
      await this.streamBatches(bucket, key, objKey, delimiter, hasHeader, onBatch);
      lastKey = objKey;
    }

    return {
      ...(lastKey && { last_processed_object_key: lastKey }),
      updated_at: new Date().toISOString(),
    };
  }

  // resolve s3 object keys from s3_uris or s3_prefix
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

  // streams a single S3 CSV object, calling onBatch every BATCH_SIZE rows.
  private async streamBatches(
    bucket: string,
    key: string,
    objKey: string,
    delimiter: string,
    hasHeader: boolean,
    onBatch: (batch: RawRecord[]) => Promise<void>
  ): Promise<void> {
    const res = await this.s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );

    const stream = res.Body as Readable;
    const parser = csvParse({
      delimiter,
      columns: hasHeader
        ? true
        : (header: string[]) =>
            header.map((_: string, i: number) => `col_${i}`),
      skip_empty_lines: true,
      relax_column_count: true,
    });

    stream.pipe(parser);

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

    // flush any remaining rows that didn't fill a full batch
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
