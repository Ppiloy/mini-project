export interface PgQueryResult<Row = Record<string, unknown>> {
  rows: Row[];
  rowCount: number;
}

export type PgQueryCallback<Row> = (error: Error | null, result?: PgQueryResult<Row>) => void;

export interface PgQueryable {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: unknown[],
    callback?: PgQueryCallback<Row>,
  ): Promise<PgQueryResult<Row>>;
  release(): void;
}

export interface PgPoolLike {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: unknown[],
    callback?: PgQueryCallback<Row>,
  ): Promise<PgQueryResult<Row>>;
  connect(): Promise<PgQueryable>;
  end?(): Promise<void>;
}
