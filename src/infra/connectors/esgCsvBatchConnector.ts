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
  FetchResult,
} from "../../domain/ports/connector.js";
import { ConnectorState } from "../../domain/models/connectorState.js";
import { SourceSpec } from "../../domain/models/jobConfig.js";
import { AppConfig } from "../../config/index.js";
import { UnprocessableError } from "../../domain/errors.js";

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
    prevState: ConnectorState | undefined
  ): Promise<FetchResult> {
    const objectKeys = await this.resolveObjectKeys(sourceSpec);

    // TODO: For incremental mode, filter out objects already processed
    //       using prevState.last_processed_object_key. Currently processes all.
    const filteredKeys =
      prevState?.last_processed_object_key
        ? objectKeys.filter((k) => k > prevState.last_processed_object_key!)
        : objectKeys;

    const delimiter = sourceSpec.delimiter ?? ",";
    const hasHeader = sourceSpec.has_header ?? true;
    const allRecords: RawRecord[] = [];
    let lastKey: string | undefined;

    for (const objKey of filteredKeys) {
      const { bucket, key } = this.parseS3Uri(objKey);
      const rows = await this.readCsv(bucket, key, delimiter, hasHeader);

      for (let i = 0; i < rows.length; i++) {
        allRecords.push({
          raw_row: rows[i],
          source_file: objKey,
          row_number: i + 1,
        });
      }
      lastKey = objKey;
    }

    const newState: Partial<ConnectorState> = {
      ...(lastKey && { last_processed_object_key: lastKey }),
      updated_at: new Date().toISOString(),
    };

    return { records: allRecords, new_state: newState };
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

  // download and parse a single csv from s3
  private async readCsv(
    bucket: string,
    key: string,
    delimiter: string,
    hasHeader: boolean
  ): Promise<Record<string, string>[]> {
    const res = await this.s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );

    const stream = res.Body as Readable;
    const rows: Record<string, string>[] = [];

    return new Promise((resolve, reject) => {
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

      parser.on("data", (record: Record<string, string>) => {
        rows.push(record);
      });
      parser.on("end", () => resolve(rows));
      parser.on("error", (err: Error) => reject(err));
    });
  }

  private parseS3Uri(uri: string): { bucket: string; key: string } {
    const match = uri.match(/^s3:\/\/([^/]+)\/(.+)$/);
    if (!match) throw new Error(`Invalid S3 URI: ${uri}`);
    return { bucket: match[1], key: match[2] };
  }
}
