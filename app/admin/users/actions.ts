"use server";

import { redirect } from "next/navigation";
import { pool } from "@/lib/db";
import {
  countActiveAdmins, deactivateUser, logEvent, reactivateUser, resetPassword, setAdmin, unlockUser,
} from "@/lib/auth/accounts";
import { requireAdmin } from "@/lib/auth/current-user";
import { parseRoster, type RosterRow } from "@/lib/staff/roster";
import { applyImport } from "@/lib/staff/import";

const back = (msg: string, extra = ""): never => redirect(`/admin/users?msg=${msg}${extra}`);

export async function userAction(form: FormData) {
  const admin = await requireAdmin();
  const userId = Number(form.get("userId"));
  const op = String(form.get("op"));
  if (!Number.isInteger(userId)) back("bad");
  switch (op) {
    case "reset":
      if (!process.env.INITIAL_PASSWORD) back("no_initial_password");
      await resetPassword(pool, userId, admin.id);
      return back("reset");
    case "unlock":
      await unlockUser(pool, userId, admin.id);
      return back("unlocked");
    case "deactivate":
      if (userId === admin.id) back("self");
      await deactivateUser(pool, userId, admin.id, "admin");
      return back("deactivated");
    case "activate":
      await reactivateUser(pool, userId, admin.id);
      return back("activated");
    case "grant_admin":
      await setAdmin(pool, userId, true, admin.id);
      return back("admin_granted");
    case "revoke_admin":
      if (userId === admin.id || (await countActiveAdmins(pool)) <= 1) back("last_admin");
      await setAdmin(pool, userId, false, admin.id);
      return back("admin_revoked");
  }
  back("bad");
}

// 1단계: 파일을 읽어 미리보기용으로 잠시 저장 (원본 파일은 저장하지 않음)
export async function previewImportAction(form: FormData) {
  const admin = await requireAdmin();
  const file = form.get("roster");
  if (!(file instanceof File) || file.size === 0) back("no_file");
  const f = file as File;
  let rows: RosterRow[];
  try {
    rows = parseRoster(Buffer.from(await f.arrayBuffer()), f.name).rows;
  } catch {
    return back("parse_failed");
  }
  await pool.query("DELETE FROM staff_import_batch WHERE created_at < now() - interval '1 day'");
  const { rows: b } = await pool.query(
    "INSERT INTO staff_import_batch (created_by, rows) VALUES ($1, $2) RETURNING id::int",
    [admin.id, JSON.stringify(rows)],
  );
  redirect(`/admin/users?batch=${b[0].id}`);
}

// 2단계: 미리보기 확인 후 반영
export async function applyImportAction(form: FormData) {
  const admin = await requireAdmin();
  const batchId = Number(form.get("batchId"));
  if (!process.env.INITIAL_PASSWORD) back("no_initial_password");
  const { rows } = await pool.query("SELECT rows FROM staff_import_batch WHERE id = $1", [batchId]);
  if (!rows[0]) back("batch_gone");
  const client = await pool.connect();
  let summary;
  try {
    ({ summary } = await applyImport(client, rows[0].rows as RosterRow[], {
      deactivateMissing: form.get("deactivateMissing") === "on",
      actorId: admin.id,
    }));
  } finally {
    client.release();
  }
  await pool.query("DELETE FROM staff_import_batch WHERE id = $1", [batchId]);
  back(
    "imported",
    `&c=${summary.created}&u=${summary.updated}&r=${summary.reactivated}&d=${summary.deactivated}`,
  );
}

export async function cancelImportAction(form: FormData) {
  const admin = await requireAdmin();
  await pool.query("DELETE FROM staff_import_batch WHERE id = $1", [Number(form.get("batchId"))]);
  await logEvent(pool, null, admin.id, "roster_import_cancelled");
  back("cancelled");
}
