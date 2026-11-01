/**
 * ClaimsSystemAdapter – integrates the photo upload module with the existing
 * Schadensmeldungssystem (claims management system).
 *
 * AC4: Integration via adapter; interface analysis in Sprint 1.
 *
 * This adapter decouples the photo module from the claims system's internal
 * API, allowing independent evolution of both systems.
 *
 * Sprint 1 deliverable: this interface definition + stub implementation.
 * Production: replace ClaimsSystemStubAdapter with the real HTTP/gRPC client
 * to the claims backend once the interface analysis is complete.
 */

export interface ClaimInfo {
  claimId: string;
  policyNumber: string;
  status: 'open' | 'in_review' | 'closed';
  createdAt: string;
}

/**
 * ClaimsSystemAdapter interface.
 * Defines the contract between the photo upload module and the claims system.
 */
export interface ClaimsSystemAdapter {
  /**
   * Verify that a claim exists and belongs to the authenticated policyholder.
   * Returns null if the claim does not exist or access is denied.
   */
  getClaimInfo(claimId: string, userId: string): Promise<ClaimInfo | null>;

  /**
   * Notify the claims system that a new photo has been attached to a claim.
   * Used to trigger downstream workflows (e.g. notify claim handler).
   */
  notifyPhotoUploaded(claimId: string, photoId: string, uploadedAt: string): Promise<void>;

  /**
   * Notify the claims system that a photo has been deleted from a claim.
   * Used to keep the claims system's audit log consistent.
   */
  notifyPhotoDeleted(claimId: string, photoId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Stub implementation (Sprint 1 / tests)
// ---------------------------------------------------------------------------

/**
 * ClaimsSystemStubAdapter – used for development and integration tests.
 *
 * Sprint 1 interface analysis outcome: the claims system exposes a REST API
 * at /internal/claims/{claimId}. The stub simulates this behaviour.
 * Replace with ClaimsSystemHttpAdapter in production.
 */
export class ClaimsSystemStubAdapter implements ClaimsSystemAdapter {
  /** Pre-seeded claims for testing */
  private readonly claims: Map<string, ClaimInfo> = new Map([
    [
      'claim-001',
      {
        claimId: 'claim-001',
        policyNumber: 'POL-12345',
        status: 'open',
        createdAt: '2024-01-15T10:00:00.000Z',
      },
    ],
    [
      'claim-002',
      {
        claimId: 'claim-002',
        policyNumber: 'POL-67890',
        status: 'in_review',
        createdAt: '2024-01-20T08:30:00.000Z',
      },
    ],
  ]);

  private readonly notifications: Array<{
    type: 'uploaded' | 'deleted';
    claimId: string;
    photoId: string;
    at: string;
  }> = [];

  async getClaimInfo(claimId: string, _userId: string): Promise<ClaimInfo | null> {
    return this.claims.get(claimId) ?? null;
  }

  async notifyPhotoUploaded(
    claimId: string,
    photoId: string,
    uploadedAt: string,
  ): Promise<void> {
    this.notifications.push({ type: 'uploaded', claimId, photoId, at: uploadedAt });
  }

  async notifyPhotoDeleted(claimId: string, photoId: string): Promise<void> {
    this.notifications.push({
      type: 'deleted',
      claimId,
      photoId,
      at: new Date().toISOString(),
    });
  }

  /** Test helper: inspect notifications sent to the claims system */
  getNotifications() {
    return [...this.notifications];
  }

  /** Test helper: seed additional claims */
  seedClaim(claim: ClaimInfo): void {
    this.claims.set(claim.claimId, claim);
  }
}
