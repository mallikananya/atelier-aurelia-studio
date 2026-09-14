export interface ProductRepository {
  createWithInitialRevision(input: {
    accountId: string;
    actorId: string;
    name: string;
    productType?: string;
  }): Promise<{ productId: string; revisionId: string }>;
}

export interface JobRepository {
  enqueueTestBuild(input: {
    accountId: string;
    actorId: string;
    productId: string;
    revisionId: string;
    idempotencyKey: string;
  }): Promise<{ jobId: string; wasCreated: boolean }>;
}

export interface WorkflowDispatcher {
  dispatchTestBuild(input: {
    jobId: string;
    accountId: string;
    productId: string;
    revisionId: string;
  }): Promise<{ providerRunId: string }>;
}

export interface SecretStore {
  read(reference: string): Promise<string>;
}
