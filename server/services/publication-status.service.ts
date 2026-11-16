/** Status transitions shared by social publishing refreshes and webhooks. */
export type PublicationStatus = "pending" | "scheduled" | "published" | "failed";

/** Normalize a Zernio status string to Xareable's publication state. */
export function mapKnownPublicationStatus(status: string | undefined): PublicationStatus | null {
  switch (status) {
    case "published":
      return "published";
    case "failed":
    case "cancelled":
      return "failed";
    case "scheduled":
      return "scheduled";
    case "pending":
    case "publishing":
    case "draft":
      return "pending";
    case "partial":
    default:
      return null;
  }
}

/**
 * Apply a provider update without allowing a confirmed publication to move
 * backwards when an older poll or webhook arrives late.
 */
export function resolvePublicationStatus(
  currentStatus: PublicationStatus,
  platformStatus: string | undefined,
  postLevelStatus: string | undefined,
): PublicationStatus {
  if (currentStatus === "published") return "published";

  return mapKnownPublicationStatus(platformStatus)
    ?? mapKnownPublicationStatus(postLevelStatus)
    ?? currentStatus;
}
