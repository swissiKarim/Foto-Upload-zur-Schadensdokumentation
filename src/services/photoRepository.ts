/**
 * PhotoRepository – persists PhotoMetadata and ClaimKpiRecords.
 *
 * Privacy-by-Design (RC-01, RC-02):
 *  - Only purpose-necessary fields are stored.
 *  - Full deletion on Art. 17 DSGVO request removes metadata AND storage blob.
 *
 * Production: replace with a real RDBMS / DocumentDB behind the same interface.
 */

import { PhotoMetadata, ClaimKpiRecord } from '../models/photo';

export interface PhotoRepository {
  save(photo: PhotoMetadata): Promise<void>;
  findByClaimId(claimId: string): Promise<PhotoMetadata[]>;
  findById(claimId: string, photoId: string): Promise<PhotoMetadata | null>;
  delete(claimId: string, photoId: string): Promise<boolean>;
  countByClaimId(claimId: string): Promise<number>;

  // KPI records (AC5)
  getKpi(claimId: string): Promise<ClaimKpiRecord>;
  updateKpiOnUpload(claimId: string, uploadedAt: string): Promise<void>;
  updateKpiOnDelete(claimId: string): Promise<void>;
}

export class InMemoryPhotoRepository implements PhotoRepository {
  private readonly photos: Map<string, PhotoMetadata> = new Map();
  private readonly kpis: Map<string, ClaimKpiRecord> = new Map();

  /** Composite key: claimId + photoId */
  private key(claimId: string, photoId: string): string {
    return `${claimId}::${photoId}`;
  }

  async save(photo: PhotoMetadata): Promise<void> {
    this.photos.set(this.key(photo.claimId, photo.photoId), photo);
  }

  async findByClaimId(claimId: string): Promise<PhotoMetadata[]> {
    return Array.from(this.photos.values()).filter(p => p.claimId === claimId);
  }

  async findById(claimId: string, photoId: string): Promise<PhotoMetadata | null> {
    return this.photos.get(this.key(claimId, photoId)) ?? null;
  }

  async delete(claimId: string, photoId: string): Promise<boolean> {
    return this.photos.delete(this.key(claimId, photoId));
  }

  async countByClaimId(claimId: string): Promise<number> {
    return (await this.findByClaimId(claimId)).length;
  }

  // ---------------------------------------------------------------------------
  // KPI helpers (AC5)
  // ---------------------------------------------------------------------------

  private ensureKpi(claimId: string): ClaimKpiRecord {
    if (!this.kpis.has(claimId)) {
      this.kpis.set(claimId, {
        claimId,
        firstPhotoUploadedAt: null,
        lastPhotoUploadedAt: null,
        totalPhotosUploaded: 0,
        processingDurationSeconds: null,
      });
    }
    return this.kpis.get(claimId)!;
  }

  async getKpi(claimId: string): Promise<ClaimKpiRecord> {
    return { ...this.ensureKpi(claimId) };
  }

  async updateKpiOnUpload(claimId: string, uploadedAt: string): Promise<void> {
    const kpi = this.ensureKpi(claimId);
    kpi.totalPhotosUploaded += 1;
    if (!kpi.firstPhotoUploadedAt) {
      kpi.firstPhotoUploadedAt = uploadedAt;
    }
    kpi.lastPhotoUploadedAt = uploadedAt;
    if (kpi.firstPhotoUploadedAt && kpi.lastPhotoUploadedAt) {
      const first = new Date(kpi.firstPhotoUploadedAt).getTime();
      const last = new Date(kpi.lastPhotoUploadedAt).getTime();
      kpi.processingDurationSeconds = Math.round((last - first) / 1000);
    }
    this.kpis.set(claimId, kpi);
  }

  async updateKpiOnDelete(claimId: string): Promise<void> {
    const kpi = this.ensureKpi(claimId);
    if (kpi.totalPhotosUploaded > 0) {
      kpi.totalPhotosUploaded -= 1;
    }
    this.kpis.set(claimId, kpi);
  }
}
