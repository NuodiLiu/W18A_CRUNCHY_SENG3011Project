export interface QueueMessage {
  receiptHandle: string;
  body: string;
}

export interface QueueService {
  sendMessage(body: Record<string, unknown>): Promise<void>;
  receiveMessages(maxMessages: number, waitSeconds: number): Promise<QueueMessage[]>;
  deleteMessage(receiptHandle: string): Promise<void>;
}
