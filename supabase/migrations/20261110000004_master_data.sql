-- =====================================================================
-- LEI APP HUB Ver.1.1 : 04 固定マスタ（共通 8 分類）と初期プリセット
--   分類の名称と順序は仕様書 02 章で固定。説明文は仮案（現物アプリと照合して確定）。
--   SELF は categories に含めない。
-- =====================================================================
insert into public.categories (id, code, title, description, sort_order) values
  (1, 'leistyle-dx',   'LEISTYLE-DX',   '組織と業務の仕組みを整える',     1),
  (2, 'life-stage-1',  'LIFE STAGE1.0', '自分の経験と価値観を整理する',   2),
  (3, 'life-stage-2',  'LIFE STAGE2.0', '人生観を深め、対話する',         3),
  (4, 'life-stage-3',  'LIFE STAGE3.0', '理想を実行・習慣へつなげる',     4),
  (5, 'real-estate',   '不動産事業',     '顧客・案件・営業活動を支援する', 5),
  (6, 'ec',            'EC事業',         '商品・販売・運営を支援する',     6),
  (7, 'after-story',   'AFTER STORY',   '活動に関するツールを集約する',   7),
  (8, 'docs-team',     '資料作成チーム', '資料制作と共同作業を進める',     8)
on conflict (id) do nothing;

insert into public.permission_presets (name, category_ids, sort_order) values
  ('全分類',           '{1,2,3,4,5,6,7,8}', 10),
  ('LIFE STAGE1.0',    '{2}',               20),
  ('不動産事業チーム', '{5,8}',             30),
  ('指定なし（SELFのみ）', '{}',            40)
on conflict (name) do nothing;
