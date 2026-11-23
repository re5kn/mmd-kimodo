# mmd-kimodo

MMD 互換ソフトに [Kimodo](https://github.com/re5kn/kimodopmx)（テキスト→モーション生成）を統合することを目指すプロジェクトです。
現在は **プロトタイプ**（Issue #1）で、Kimodo 連携はまだ含みません。

## プロトタイプでできること

- PMX（2.0 / 2.1）の読み込みとモデル表示（テクスチャ・トゥーン風シェーディング・輪郭線）
  - PMX 単体、モデルフォルダ、ZIP（Shift_JIS のファイル名にも対応）から読み込み
  - フォルダ / ZIP に複数の PMX がある場合は選択可能
- VMD の読み込み（ボーン・モーフ・IK ON/OFF）
  - ベジェ補間、付与（回転 / 移動）、IK（CCD、ひざの角度制限つき）、頂点モーフ / グループモーフ
- タイムラインで 1 フレームごとの表示確認
  - フレーム番号入力、±1 フレーム、前後のキーフレームへ移動、スライダー / タイムラインのドラッグ
  - ボーン / モーフごとのキーフレーム表示、再生 / 停止（30 fps）、ループ
  - キーボード: `←` `→`（Shift で 10 フレーム）、`Space` 再生、`Home` / `End`
- ドラッグ&ドロップ（PMX / フォルダ / ZIP / VMD）

未対応: ボーン / 材質 / UV モーフ、SDEF（BDEF2 として扱う）、スフィアマップ、共有トゥーンテクスチャ、カメラ / 照明モーション、PMD

## 物理演算（Issue #3 Part 1）

- PMX の剛体（球 / 箱 / カプセル、ボーン追従・物理演算・物理+ボーン位置合わせ）とジョイント（6DOF バネ）を Ammo.js（Bullet の WebAssembly 版、MMD 本体と同じエンジン）で計算
- 操作領域の「物理演算」で ON/OFF、エンジン選択（Rapier は Part 2 で実装予定のため選択不可）、剛体のワイヤーフレーム表示（緑: ボーン追従、橙: 物理、黄: 物理+位置合わせ）、物理リセット
- 停止中も演算を続けます。シーク（逆再生や 3 フレーム以上の移動）やモーションの変更では、その姿勢から演算をやり直します
- 実装は `frontend/src/physics/`。`PhysicsEngine` インターフェース（剛体とジョイントの登録 / ボーン姿勢を渡す / 1 ステップ進める / 剛体の姿勢をボーンに戻す）の実装として `AmmoPhysics` があり、Rapier は同じインターフェースで追加します
- 座標は PMX のまま（左手系）で計算し、剛体・ジョイントの回転は Y→X→Z 順のオイラー角として扱います

## 画面

```
┌──────────┬──────────────────────────────┐
│ 操作領域 │ モデル表示領域                │
│ (読込・  │ (three.js, マウスで回転/ズーム)│
│  表示切替│                              │
│  情報)   ├──────────────────────────────┤
│          │ タイムライン領域               │
└──────────┴──────────────────────────────┘
```

## 起動（Docker）

```bash
docker compose up -d --build
# http://localhost:8080 を開く
```

ポートを変える場合は `PORT=8090 docker compose up -d --build`。
`samples/` にテスト用のモデル（`sample-model/`）とモーション（`sample-walk.vmd`）があります。
フロントは `frontend/scripts/make-sample.mjs` で再生成できます（`npm run sample`）。

## 構成

| ディレクトリ | 内容 |
| --- | --- |
| `backend/src/MmdKimodo.Core` | PMX / VMD パーサ（C#, .NET 10, 依存なし） |
| `backend/src/MmdKimodo.Api` | ASP.NET Core Minimal API。アップロード保存、PMX/VMD を JSON に変換、テクスチャ配信、ビルド済みフロントの配信 |
| `backend/tests/MmdKimodo.Tests` | xUnit テスト |
| `frontend/` | TypeScript + React + three.js（Vite） |
| `frontend/src/mmd/` | モーション補間・ボーン計算（付与 / IK）・モーフ |
| `frontend/src/viewer/` | three.js のシーン、SkinnedMesh 構築 |
| `frontend/src/components/` | 操作領域・モデル表示・タイムラインの各コンポーネント |

### API

| メソッド | パス | 内容 |
| --- | --- | --- |
| POST | `/api/models` | multipart。`files`（PMX・テクスチャ・ZIP）と、同順の `paths`（フォルダ相対パス）、任意で `pmx` |
| GET | `/api/uploads/{id}/model?pmx=...` | 同じアップロード内の別 PMX を読み込み |
| GET | `/api/uploads/{id}/files/{path}` | テクスチャ等の取得 |
| POST | `/api/motions` | multipart。`file`（VMD）をパースして返す（保存しない） |

座標は PMX のまま（左手系・Y 上・モデルは -Z 向き）で返し、フロントで Z 反転して three.js（右手系）に変換します。
ボーン計算は PMX 座標で行い、結果のローカル姿勢だけを変換しています。

## 開発

必要なもの: .NET SDK 10、Node.js 22

```bash
# バックエンド (http://localhost:5080)
cd backend
dotnet run --project src/MmdKimodo.Api
dotnet test

# フロントエンド (http://localhost:5173, /api は 5080 にプロキシ)
cd frontend
npm ci
npm run dev
npm test
```

アップロードされたファイルは一時ディレクトリ（Docker では `/data/uploads`）に保存され、新しいものから 8 件だけ残します（`Storage__MaxUploads`）。
