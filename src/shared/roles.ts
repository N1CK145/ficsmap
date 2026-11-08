/**
 * A user's role in one world: the owner (exactly one, `worlds.owner_id`), admins (named by the owner) and members.
 * Admins may do everything the owner may, except deleting the world, changing roles and removing other admins.
 */
export type WorldRole = 'owner' | 'admin' | 'member';

/** The role a member can be given (`PUT /api/worlds/:id/members/:userId/role`); ownership is never handed over. */
export type MemberRole = Exclude<WorldRole, 'owner'>;

const RANK: Record<WorldRole, number> = { member: 0, admin: 1, owner: 2 };

/** True when `role` is `min` or above (owner > admin > member). */
export function hasRole(role: WorldRole, min: WorldRole): boolean {
  return RANK[role] >= RANK[min];
}

/** Owner or admin: may import saves, manage invites and upload keys, rename the world and remove members. */
export function canAdmin(role: WorldRole): boolean {
  return hasRole(role, 'admin');
}
