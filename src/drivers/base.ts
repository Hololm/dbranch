export interface SnapshotInfo {
  branch: string;
  fileName: string;
  size: number;
  createdAt: Date;
}

export interface DatabaseDriver {
  snapshot(branchName: string): Promise<void>;
  restore(branchName: string): Promise<void>;
  hasSnapshot(branchName: string): Promise<boolean>;
  deleteSnapshot(branchName: string): Promise<void>;
  validate(): Promise<boolean>;
  listSnapshots(): Promise<SnapshotInfo[]>;
}
