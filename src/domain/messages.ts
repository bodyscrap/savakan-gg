export type FeatureMessage = {
  destination?: string;
  messageId: string;
  threadId: string;
  parentMessageId: string | null;
  messageType: "normal" | "resolve" | "dq_request";
  messageMeta: Record<string, unknown> | null;
  method: string;
  subject: string;
  senderName: string;
  senderUserId: string;
  senderIp: string;
  body: string;
  createdAt: string;
};
