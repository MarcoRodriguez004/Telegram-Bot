export type ContingencyMode = "always" | "vehicle";
export type VehicleHologram = "0" | "00";

export interface UserVehicle {
  id: number;
  label: string;
  hologram: VehicleHologram;
  plateLastDigit: number;
  enabled: boolean;
  createdAt: string;
}

export interface ContingencyPreferences {
  mode: ContingencyMode | null;
  enabled: boolean;
  updatedAt: string | null;
}

export interface ContingencyRecipient {
  userId: number;
  chatId: number;
  mode: ContingencyMode;
}

export async function registerVehicle(
  db: D1Database,
  input: { userId: number; label?: string; hologram: VehicleHologram; plateLastDigit: number; createdAt?: string },
): Promise<UserVehicle> {
  assertUserId(input.userId);
  if (input.hologram !== "0" && input.hologram !== "00") throw new Error("Vehicle hologram is invalid");
  if (!Number.isInteger(input.plateLastDigit) || input.plateLastDigit < 0 || input.plateLastDigit > 9) {
    throw new Error("Vehicle plate digit is invalid");
  }
  const label = normalizeLabel(input.label) || await defaultVehicleLabel(db, input.userId);
  const createdAt = input.createdAt ?? new Date().toISOString();
  const result = await db.prepare(
    "INSERT INTO user_vehicles (user_id, label, hologram, plate_last_digit, created_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(input.userId, label, input.hologram, input.plateLastDigit, createdAt).run();
  const id = Number(result.meta.last_row_id);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("Vehicle could not be created");
  return { id, label, hologram: input.hologram, plateLastDigit: input.plateLastDigit, enabled: true, createdAt };
}

export async function listVehicles(db: D1Database, userId: number): Promise<UserVehicle[]> {
  assertUserId(userId);
  const result = await db.prepare(
    "SELECT id, label, hologram, plate_last_digit AS plateLastDigit, enabled, created_at AS createdAt FROM user_vehicles WHERE user_id = ? AND enabled = 1 ORDER BY id",
  ).bind(userId).all<UserVehicleRow>();
  return result.results.map(toVehicle);
}

export async function removeVehicle(db: D1Database, input: { userId: number; vehicleId: number }): Promise<boolean> {
  assertUserId(input.userId);
  if (!Number.isSafeInteger(input.vehicleId) || input.vehicleId < 1) throw new Error("Vehicle id is invalid");
  const result = await db.prepare("UPDATE user_vehicles SET enabled = 0 WHERE user_id = ? AND id = ? AND enabled = 1")
    .bind(input.userId, input.vehicleId).run();
  return result.meta.changes === 1;
}

export async function getContingencyPreferences(db: D1Database, userId: number): Promise<ContingencyPreferences> {
  assertUserId(userId);
  const row = await db.prepare(
    "SELECT mode, enabled, updated_at AS updatedAt FROM contingency_preferences WHERE user_id = ?",
  ).bind(userId).first<ContingencyPreferencesRow>();
  const mode = row
    ? row.mode === "always" || row.mode === "vehicle" ? row.mode : null
    : "always";
  return { mode, enabled: row ? mode !== null && row.enabled === 1 : true, updatedAt: row?.updatedAt ?? null };
}

export async function setContingencyMode(
  db: D1Database,
  input: { userId: number; mode: ContingencyMode | null; now?: string },
): Promise<void> {
  assertUserId(input.userId);
  const now = input.now ?? new Date().toISOString();
  await db.prepare(
    "INSERT INTO contingency_preferences (user_id, mode, enabled, updated_at) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(user_id) DO UPDATE SET mode = excluded.mode, enabled = excluded.enabled, updated_at = excluded.updated_at",
  ).bind(input.userId, input.mode, input.mode ? 1 : 0, now).run();
}

export async function listContingencyRecipients(
  db: D1Database,
  restriction: { holograms: VehicleHologram[]; plateLastDigits: number[] } | null,
  ownerTelegramUserId?: number,
): Promise<ContingencyRecipient[]> {
  const rows = await db.prepare(
      "SELECT u.id AS userId, u.telegram_chat_id AS chatId, COALESCE(p.mode, 'always') AS mode " +
      "FROM users u LEFT JOIN contingency_preferences p ON p.user_id = u.id " +
      "WHERE (p.user_id IS NULL OR (p.enabled = 1 AND p.mode IS NOT NULL)) AND (? IS NULL OR u.telegram_user_id = ?) AND (COALESCE(p.mode, 'always') = 'always' OR ? = 1 OR EXISTS (" +
      "SELECT 1 FROM user_vehicles v WHERE v.user_id = p.user_id AND v.enabled = 1 AND v.hologram IN (?, ?) AND v.plate_last_digit IN (?, ?)" +
      ")) ORDER BY p.user_id",
  ).bind(
    ownerTelegramUserId ?? null,
    ownerTelegramUserId ?? null,
    restriction ? 0 : 1,
    restriction?.holograms[0] ?? "0",
    restriction?.holograms[1] ?? "00",
    restriction?.plateLastDigits[0] ?? -1,
    restriction?.plateLastDigits[1] ?? -1,
  ).all<ContingencyRecipientRow>();
  return rows.results
    .filter((row) => (row.mode === "always" || row.mode === "vehicle") && Number.isSafeInteger(row.chatId))
    .map((row) => ({ userId: Number(row.userId), chatId: Number(row.chatId), mode: row.mode as ContingencyMode }));
}

export interface ContingencyState {
  active: boolean;
  phase: "I" | null;
  restrictionSignature: string | null;
  restrictionsText: string | null;
  sourceUrl: string;
  publishedAt: string | null;
  updatedAt: string;
  lastCheckedAt: string;
}

export async function getContingencyState(db: D1Database): Promise<ContingencyState | null> {
  const row = await db.prepare(
    "SELECT active, phase, restriction_signature AS restrictionSignature, restrictions_text AS restrictionsText, source_url AS sourceUrl, published_at AS publishedAt, updated_at AS updatedAt, last_checked_at AS lastCheckedAt FROM contingency_state WHERE id = 1",
  ).first<ContingencyStateRow>();
  return row ? toState(row) : null;
}

export async function saveContingencyState(
  db: D1Database,
  input: Omit<ContingencyState, "updatedAt" | "lastCheckedAt"> & { now: string },
): Promise<{ changed: boolean; previous: ContingencyState | null }> {
  const previous = await getContingencyState(db);
  const changed = !previous || previous.active !== input.active || previous.phase !== input.phase || previous.restrictionSignature !== input.restrictionSignature;
  await db.prepare(
    "INSERT INTO contingency_state (id, active, phase, restriction_signature, restrictions_text, source_url, published_at, updated_at, last_checked_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET active = excluded.active, phase = excluded.phase, restriction_signature = excluded.restriction_signature, restrictions_text = excluded.restrictions_text, source_url = excluded.source_url, published_at = excluded.published_at, updated_at = CASE WHEN contingency_state.active != excluded.active OR COALESCE(contingency_state.phase, '') != COALESCE(excluded.phase, '') OR COALESCE(contingency_state.restriction_signature, '') != COALESCE(excluded.restriction_signature, '') THEN excluded.updated_at ELSE contingency_state.updated_at END, last_checked_at = excluded.last_checked_at",
  ).bind(
    input.active ? 1 : 0,
    input.phase,
    input.restrictionSignature,
    input.restrictionsText,
    input.sourceUrl,
    input.publishedAt,
    input.now,
    input.now,
  ).run();
  return { changed, previous };
}

interface UserVehicleRow { id: number; label: string; hologram: string; plateLastDigit: number; enabled: number; createdAt: string }
interface ContingencyPreferencesRow { mode: string | null; enabled: number; updatedAt: string }
interface ContingencyRecipientRow { userId: number; chatId: number; mode: string }
interface ContingencyStateRow { active: number; phase: string | null; restrictionSignature: string | null; restrictionsText: string | null; sourceUrl: string; publishedAt: string | null; updatedAt: string; lastCheckedAt: string }

function toVehicle(row: UserVehicleRow): UserVehicle {
  return { id: Number(row.id), label: row.label, hologram: row.hologram as VehicleHologram, plateLastDigit: Number(row.plateLastDigit), enabled: row.enabled === 1, createdAt: row.createdAt };
}

function toState(row: ContingencyStateRow): ContingencyState {
  return { active: row.active === 1, phase: row.phase === "I" ? "I" : null, restrictionSignature: row.restrictionSignature, restrictionsText: row.restrictionsText, sourceUrl: row.sourceUrl, publishedAt: row.publishedAt, updatedAt: row.updatedAt, lastCheckedAt: row.lastCheckedAt };
}

async function defaultVehicleLabel(db: D1Database, userId: number): Promise<string> {
  const row = await db.prepare("SELECT COUNT(*) AS count FROM user_vehicles WHERE user_id = ?").bind(userId).first<{ count: number }>();
  return `Vehículo ${Number(row?.count ?? 0) + 1}`;
}

function normalizeLabel(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").slice(0, 50);
}

function assertUserId(userId: number): void {
  if (!Number.isSafeInteger(userId) || userId < 1) throw new Error("User id is invalid");
}
