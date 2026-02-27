import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  GetQueueUrlCommand,
  Message,
} from "@aws-sdk/client-sqs";
import { QueueService, QueueMessage } from "../../domain/ports/queueService.js";
import { AppConfig } from "../../config/index.js";

export class SQSQueueService implements QueueService {
  private readonly sqs: SQSClient;
  private readonly queueName: string;
  private queueUrl: string | undefined;

  constructor(config: AppConfig) {
    this.sqs = new SQSClient({
      region: config.region,
      ...(config.sqsEndpoint && { endpoint: config.sqsEndpoint }),
    });
    this.queueName = config.sqsQueueName;
  }

  async sendMessage(body: Record<string, unknown>): Promise<void> {
    const url = await this.resolveQueueUrl();
    await this.sqs.send(
      new SendMessageCommand({
        QueueUrl: url,
        MessageBody: JSON.stringify(body),
      })
    );
  }

  async receiveMessages(
    maxMessages: number,
    waitSeconds: number
  ): Promise<QueueMessage[]> {
    const url = await this.resolveQueueUrl();
    const res = await this.sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: url,
        MaxNumberOfMessages: maxMessages,
        WaitTimeSeconds: waitSeconds,
      })
    );

    if (!res.Messages) return [];

    return res.Messages.map((m: Message) => ({
      receiptHandle: m.ReceiptHandle!,
      body: m.Body!,
    }));
  }

  async deleteMessage(receiptHandle: string): Promise<void> {
    const url = await this.resolveQueueUrl();
    await this.sqs.send(
      new DeleteMessageCommand({
        QueueUrl: url,
        ReceiptHandle: receiptHandle,
      })
    );
  }

  private async resolveQueueUrl(): Promise<string> {
    if (this.queueUrl) return this.queueUrl;
    const res = await this.sqs.send(
      new GetQueueUrlCommand({ QueueName: this.queueName })
    );
    const url = res.QueueUrl;
    if (!url) throw new Error(`Could not resolve queue URL for: ${this.queueName}`);
    this.queueUrl = url;
    return url;
  }
}
