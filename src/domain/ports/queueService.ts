/**
 * Port: Queue service — send & receive messages from SQS.
 */

export interface QueueMessage {
  receiptHandle: string;
  body: string;
}

export interface QueueService {
  /** Send a message to the import-jobs queue. */
  sendMessage(body: Record<string, unknown>): Promise<void>;

  /**
   * Long-poll for messages.
   * @param maxMessages  Max messages per poll (1–10)
   * @param waitSeconds  Long-poll wait time in seconds
   */
  receiveMessages(maxMessages: number, waitSeconds: number): Promise<QueueMessage[]>;

  /** Delete a successfully processed message. */
  deleteMessage(receiptHandle: string): Promise<void>;
}
