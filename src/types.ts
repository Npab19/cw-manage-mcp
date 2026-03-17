export interface PaginationParams {
  conditions?: string;
  childConditions?: string;
  customFieldConditions?: string;
  orderBy?: string;
  fields?: string;
  page?: number;
  pageSize?: number;
  pageId?: number;
  [key: string]: unknown; // allow extra keys from tool args (companyId, publicKey, etc.) to pass through safely
}

export interface CwRequestContext {
  companyId: string;
  publicKey: string;
  privateKey: string;
}

export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};
