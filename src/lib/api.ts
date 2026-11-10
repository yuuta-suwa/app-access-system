// データアクセス層。認可はすべて DB(RLS/RPC) 側で行い、ここでは権限判定をしない。
// 取得データは React の状態（メモリ）にのみ保持し、localStorage 等へは保存しない。
import { supabase } from './supabase';

export type Status = 'pending' | 'active' | 'suspended';
export type Role = 'member' | 'creator' | 'admin';

export interface MyAccess {
  user_id: string;
  email: string;
  display_name: string | null;
  status: Status;
  roles: Role[];
  category_ids: number[];
}
export interface Category { id: number; code: string; title: string; description: string; sort_order: number }
export interface Purpose { id: string; category_id: number; title: string; description: string | null; sort_order: number }
export interface CatalogApp {
  id: string; title: string; description: string; outcome: string; usage_scene: string;
  launch_url: string; owner_name: string | null; last_verified_at: string | null;
}
export interface Folder { id: string; name: string; sort_order: number }
export interface PersonalItem {
  id: string; kind: 'link' | 'catalog'; catalog_app_id: string | null; external_url: string | null;
  custom_title: string | null; note: string | null; folder_id: string | null; sort_order: number;
  updated_at: string;
}
export interface SearchResult {
  result_type: 'category' | 'purpose' | 'app'; id: string; title: string; snippet: string;
  category_code: string; category_title: string;
}

const CATEGORY_COLS = 'id, code, title, description, sort_order';
const PURPOSE_COLS = 'id, category_id, title, description, sort_order';
const APP_COLS = 'id, title, description, outcome, usage_scene, launch_url, owner_name, last_verified_at';
const ITEM_COLS = 'id, kind, catalog_app_id, external_url, custom_title, note, folder_id, sort_order, updated_at';

function must<T>(r: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (r.error) throw new ApiError(r.error.message, r.error.code);
  return r.data as T;
}

export class ApiError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
  }
}

export function friendlyError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === '42501') return 'この操作を行う権限がありません。';
    if (e.code === '23514') return '入力内容が規則に合っていません（URL は https:// のみ）。';
    if (e.code === '23505') return '同じ内容がすでに登録されています。';
    if (e.code === 'PGRST301' || /JWT/i.test(e.message)) return 'セッションの有効期限が切れました。再度ログインしてください。';
    return e.message;
  }
  return '通信に失敗しました。時間をおいて再度お試しください。';
}

// ---------------- 利用者 ----------------
export async function getMyAccess(): Promise<MyAccess | null> {
  return must(await supabase.rpc('get_my_access')) as MyAccess | null;
}

export async function listCategories(): Promise<Category[]> {
  return must(await supabase.from('categories').select(CATEGORY_COLS).order('sort_order'));
}

export async function getCategoryByCode(code: string): Promise<Category | null> {
  return must(await supabase.from('categories').select(CATEGORY_COLS).eq('code', code).maybeSingle());
}

export async function listPurposes(categoryId: number): Promise<Purpose[]> {
  return must(await supabase.from('purposes').select(PURPOSE_COLS).eq('category_id', categoryId).order('sort_order').order('title'));
}

export async function getPurpose(id: string): Promise<Purpose | null> {
  if (!isUuid(id)) return null;
  return must(await supabase.from('purposes').select(PURPOSE_COLS).eq('id', id).maybeSingle());
}

export async function listAppsForPurpose(purposeId: string): Promise<CatalogApp[]> {
  const links = must(await supabase.from('app_purposes').select('app_id, sort_order').eq('purpose_id', purposeId).order('sort_order')) as { app_id: string }[];
  if (links.length === 0) return [];
  const apps = must(await supabase.from('catalog_apps').select(APP_COLS).in('id', links.map((l) => l.app_id))) as CatalogApp[];
  const order = new Map(links.map((l, i) => [l.app_id, i]));
  return apps.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export async function getApp(id: string): Promise<{ app: CatalogApp; purposes: Purpose[]; categories: Category[] } | null> {
  if (!isUuid(id)) return null;
  const app = must(await supabase.from('catalog_apps').select(APP_COLS).eq('id', id).maybeSingle()) as CatalogApp | null;
  if (!app) return null;
  const links = must(await supabase.from('app_purposes').select('purpose_id').eq('app_id', id)) as { purpose_id: string }[];
  const purposes = links.length
    ? (must(await supabase.from('purposes').select(PURPOSE_COLS).in('id', links.map((l) => l.purpose_id))) as Purpose[])
    : [];
  const catIds = [...new Set(purposes.map((p) => p.category_id))];
  const categories = catIds.length
    ? (must(await supabase.from('categories').select(CATEGORY_COLS).in('id', catIds).order('sort_order')) as Category[])
    : [];
  return { app, purposes, categories };
}

export async function getAppsByIds(ids: string[]): Promise<CatalogApp[]> {
  if (ids.length === 0) return [];
  return must(await supabase.from('catalog_apps').select(APP_COLS).in('id', ids));
}

export async function search(q: string): Promise<SearchResult[]> {
  return must(await supabase.rpc('search_hub', { p_q: q }));
}

// ---------------- SELF（本人専用） ----------------
export async function listFolders(): Promise<Folder[]> {
  return must(await supabase.from('personal_folders').select('id, name, sort_order').order('sort_order').order('name'));
}
export async function createFolder(name: string, sort_order: number): Promise<void> {
  must(await supabase.from('personal_folders').insert({ name, sort_order }));
}
export async function renameFolder(id: string, name: string): Promise<void> {
  must(await supabase.from('personal_folders').update({ name }).eq('id', id));
}
export async function deleteFolder(id: string): Promise<void> {
  must(await supabase.from('personal_folders').delete().eq('id', id));
}

export async function listItems(): Promise<PersonalItem[]> {
  return must(await supabase.from('personal_items').select(ITEM_COLS).order('sort_order').order('created_at'));
}
export async function createLink(input: { title: string; url: string; note?: string; folder_id?: string | null; sort_order: number }): Promise<void> {
  must(await supabase.from('personal_items').insert({
    kind: 'link', custom_title: input.title, external_url: input.url,
    note: input.note || null, folder_id: input.folder_id || null, sort_order: input.sort_order,
  }));
}
export async function saveCatalogToSelf(appId: string, sort_order = 0): Promise<void> {
  must(await supabase.from('personal_items').insert({ kind: 'catalog', catalog_app_id: appId, sort_order }));
}
export async function updateItem(id: string, patch: Partial<Pick<PersonalItem, 'custom_title' | 'external_url' | 'note' | 'folder_id' | 'sort_order'>>): Promise<void> {
  must(await supabase.from('personal_items').update(patch).eq('id', id));
}
export async function deleteItem(id: string): Promise<void> {
  must(await supabase.from('personal_items').delete().eq('id', id));
}
export async function mySavedCatalogIds(): Promise<Set<string>> {
  const rows = must(await supabase.from('personal_items').select('catalog_app_id').eq('kind', 'catalog')) as { catalog_app_id: string | null }[];
  return new Set(rows.map((r) => r.catalog_app_id).filter((x): x is string => !!x));
}

// ---------------- 制作者申請 ----------------
export interface SubmissionPayload {
  title: string; description: string; outcome: string; usage_scene: string; launch_url: string;
  purpose_ids: string[]; owner_name: string; screenshot_url?: string; note?: string;
}
export interface MySubmission { id: string; target_app_id: string | null; payload: SubmissionPayload; status: string; review_note: string | null; reviewed_at: string | null; created_at: string }

export async function listMySubmissions(): Promise<MySubmission[]> {
  return must(await supabase.from('app_submissions').select('id, target_app_id, payload, status, review_note, reviewed_at, created_at').order('created_at', { ascending: false }));
}
export async function createSubmission(payload: SubmissionPayload): Promise<void> {
  must(await supabase.from('app_submissions').insert({ payload }));
}

// ---------------- 管理者（すべて DB 側で admin を再検証） ----------------
export interface AdminUserRow { user_id: string; email: string; display_name: string | null; status: Status; category_count: number; roles: Role[]; last_sign_in_at: string | null; created_at: string }
export interface AdminUserDetail extends Omit<AdminUserRow, 'category_count'> { category_ids: number[]; status_changed_at: string | null }
export interface Preset { id: string; name: string; category_ids: number[]; sort_order: number; updated_at: string }
export interface AuditRow { id: number; at: string; action: string; actor_id: string | null; actor_email: string | null; target_user_id: string | null; target_email: string | null; category_id: number | null; category_title: string | null; target_app_id: string | null; before_value: unknown; after_value: unknown; reason: string | null }
export interface AdminApp extends CatalogApp { status: string; owner_id: string | null; updated_at: string; purpose_ids: string[]; category_titles: string[] }
export interface AdminPurpose { id: string; category_id: number; category_title: string; title: string; description: string | null; sort_order: number }
export interface AdminSubmission { id: string; submitted_by: string; submitter_email: string | null; target_app_id: string | null; payload: SubmissionPayload; status: string; review_note: string | null; reviewed_at: string | null; created_at: string }
export interface Invitation { email: string; category_ids: number[]; reason: string | null; invited_at: string; consumed_at: string | null }

export const admin = {
  listCategories: async (): Promise<Category[]> => must(await supabase.rpc('admin_list_categories')),
  listUsers: async (q: string): Promise<AdminUserRow[]> => must(await supabase.rpc('admin_list_users', { p_query: q || null })),
  getUser: async (id: string): Promise<AdminUserDetail> => must(await supabase.rpc('admin_get_user', { p_user_id: id })),
  saveUserAccess: async (id: string, status: Status, categoryIds: number[], reason: string) =>
    must(await supabase.rpc('admin_save_user_access', { p_user_id: id, p_status: status, p_category_ids: categoryIds, p_reason: reason })),
  setRoles: async (id: string, roles: Role[], reason: string) =>
    must(await supabase.rpc('admin_set_roles', { p_user_id: id, p_roles: roles, p_reason: reason })),
  auditLogs: async (target: string | null, limit = 200): Promise<AuditRow[]> =>
    must(await supabase.rpc('admin_list_audit_logs', { p_target_user_id: target, p_limit: limit })),
  listPresets: async (): Promise<Preset[]> => must(await supabase.rpc('admin_list_presets')),
  savePreset: async (id: string | null, name: string, categoryIds: number[], sort: number) =>
    must(await supabase.rpc('admin_save_preset', { p_id: id, p_name: name, p_category_ids: categoryIds, p_sort_order: sort })),
  deletePreset: async (id: string) => must(await supabase.rpc('admin_delete_preset', { p_id: id })),
  invite: async (email: string, categoryIds: number[], reason: string) =>
    must(await supabase.rpc('admin_invite_user', { p_email: email, p_category_ids: categoryIds, p_reason: reason })),
  listInvitations: async (): Promise<Invitation[]> => must(await supabase.rpc('admin_list_invitations')),
  revokeInvitation: async (email: string) => must(await supabase.rpc('admin_revoke_invitation', { p_email: email })),
  listPurposes: async (): Promise<AdminPurpose[]> => must(await supabase.rpc('admin_list_purposes')),
  savePurpose: async (id: string | null, categoryId: number, title: string, description: string, sort: number) =>
    must(await supabase.rpc('admin_save_purpose', { p_id: id, p_category_id: categoryId, p_title: title, p_description: description, p_sort_order: sort })),
  deletePurpose: async (id: string) => must(await supabase.rpc('admin_delete_purpose', { p_id: id })),
  listApps: async (): Promise<AdminApp[]> => must(await supabase.rpc('admin_list_apps')),
  saveApp: async (a: {
    id: string | null; title: string; description: string; outcome: string; usage_scene: string; launch_url: string;
    owner_name: string; last_verified_at: string | null; status: string; purpose_ids: string[]; reason: string;
  }) =>
    must(await supabase.rpc('admin_save_app', {
      p_id: a.id, p_title: a.title, p_description: a.description, p_outcome: a.outcome, p_usage_scene: a.usage_scene,
      p_launch_url: a.launch_url, p_owner_name: a.owner_name, p_last_verified_at: a.last_verified_at || null,
      p_status: a.status, p_purpose_ids: a.purpose_ids, p_reason: a.reason,
    })) as string,
  listSubmissions: async (status: string | null): Promise<AdminSubmission[]> => must(await supabase.rpc('admin_list_submissions', { p_status: status })),
  reviewSubmission: async (id: string, decision: 'approved' | 'rejected', note: string) =>
    must(await supabase.rpc('admin_review_submission', { p_id: id, p_decision: decision, p_note: note })),
};

export function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

export function formatDate(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
export function formatDay(s: string | null | undefined): string {
  if (!s) return '—';
  return s.slice(0, 10).replace(/-/g, '/');
}
