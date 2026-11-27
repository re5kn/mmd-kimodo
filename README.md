# mmd-kimodo

MMD 互換ソフトに [Kimodo](https://github.com/re5kn/kimodopmx)（テキスト→モーション生成）を統合することを目指すプロジェクトです。
現在は **プロトタイプ**（Issue #1）です。Kimodo によるモーション生成（Issue #6）はモーション作成・編集から使えます。

## プロトタイプでできること

- PMX（2.0 / 2.1）の読み込みとモデル表示（テクスチャ・トゥーン風シェーディング・輪郭線）
  - PMX 単体、モデルフォルダ、ZIP（Shift_JIS のファイル名にも対応）から読み込み
  - フォルダ / ZIP に複数の PMX がある場合は選択可能
- VMD の読み込み（ボーン・モーフ・IK ON/OFF）
  - ベジェ補間、付与（回転 / 移動）、IK（CCD、ひざの角度制限つき）、頂点モーフ / グループモーフ
- タイムラインで 1 フレームごとの表示確認
  - 最上部に **モーションレイヤー**。読み込んだ VMD は現在フレームの位置から 1 つの塊として追加され、クリックで選択
    （重なったフレームは後から追加したモーションが優先。モーションブレンドは今後対応）
  - フレーム番号入力、±1 フレーム、前後のモーション端 / キーフレームへ移動、スライダー / タイムラインのドラッグ
  - 再生 / 停止（30 fps）、ループ
  - キーボード: `←` `→`（Shift で 10 フレーム）、`Space` 再生、`Home` / `End`、`Delete` 選択中のモーションを外す
- モーション編集 / 作成の呼び出し（Issue #4）
  - 編集: モーションを選択して「モーション編集」。作成: 現在フレームにモーションがないとき「モーション作成」
  - 編集・作成中は操作領域が専用表示になり、タイムラインにボーン / モーフごとのキーフレームを表示。「〜を終了」または `Esc` で戻る
  - 位置・回転の変更はまだできません（キーのない作成中モーションは終了時に破棄）
  - 「Kimodo で生成」でモーションを生成できます（下記）
- ドラッグ&ドロップ（PMX / フォルダ / ZIP / VMD）
- 表示プリセット（Issue #11 B1）: 操作領域の「表示」でワンクリック切替
  - **MMD 風**（既定）: トゥーン陰影 / **フラット**: 光なしでテクスチャ（なければ材質色）のみ / **PBR 風**: 物理ベース + 環境光（反射強度から粗さを推定） / **粘土**: グレー一色（テクスチャは透過だけに使用）
  - **リアル調**: ray-mmd などのエフェクトを重ねた見た目に寄せたもの。材質名（とテクスチャ・スフィア名）から 髪 / 服 / 肌 / 金属 / 目・表情 を推定し、
    服は布の光沢（sheen）と布目の凹凸、髪は異方性ハイライトと毛筋、肌は明暗の境目に赤みが回る簡易的な表面下散乱と暖色寄りの色補正、目・表情・描き影は光の影響なしで描きます。照明は強めの主光源 + 青みの空光 + ACES トーンマップ、輪郭線は半分の太さ。
    布目・毛筋はコードで生成したノーマルマップを、材質ごとの UV の大きさからモデル上で一定の細かさになるよう敷き詰めます。影・被写界深度・ブルームはまだありません
  - 輪郭線・グリッドなどの設定はプリセットと独立。材質は初回切替時に作って保持するので、2 回目以降の切替は一瞬です

未対応: ボーン / UV モーフ、SDEF（BDEF2 として扱う）、カメラ / 照明モーション、PMD（スフィアマップと共有トゥーンは対応済み。共有トゥーンは自作の代替画像）

## 物理演算（Issue #3）

- PMX の剛体（球 / 箱 / カプセル、ボーン追従・物理演算・物理+ボーン位置合わせ）とジョイント（6DOF バネ）を計算。エンジンは 2 種類から選べます
  - **Ammo.js**（既定）: Bullet の WebAssembly 版で、MMD 本体と同じエンジン。揺れ方を MMD に近づけたいときに
  - **Rapier**: Rust 製で高速。Bullet の 6DOF バネに当たる部品がないため、汎用ジョイント（軸ごとの固定・可動範囲）とモーター（バネの代わり）で近似しており、揺れ方は MMD と一致しません
- 操作領域の「物理演算」で ON/OFF、エンジン選択、剛体のワイヤーフレーム表示（緑: ボーン追従、橙: 物理、黄: 物理+位置合わせ）、物理リセット
- 停止中も演算を続けます。シーク（逆再生や 3 フレーム以上の移動）やモーションの変更では、その姿勢から演算をやり直します
- 実装は `frontend/src/physics/`。`PhysicsEngine` インターフェース（剛体とジョイントの登録 / ボーン姿勢を渡す / 1 ステップ進める / 剛体の姿勢をボーンに戻す）の実装として `AmmoPhysics` と `RapierPhysics` があり、選んだ方だけを動的 import で読み込みます。エンジンに依存しない計算（剛体とボーンのオフセットなど）は `PhysicsRig` にあります
- 座標は PMX のまま（左手系）で計算し、剛体・ジョイントの回転は Y→X→Z 順のオイラー角として扱います

## Kimodo でモーション生成（Issue #6）

モーション作成・編集の操作領域にある「KIMODO で生成」で、**プロンプト（英語）** と **長さ（2〜10 秒、既定 6 秒）** を指定して生成します。
その他のパラメータは Kimodo デモの既定値です（シード 42、Denoising Steps 100、CFG 2.0 / 2.0、Transition frames 5、Post Processing オン）。

- 生成結果は **現在フレームから** 入ります。作成中は空のモーションに、編集中は既存モーションの該当範囲を置き換えます
  （置き換えるのは生成したボーンのキーだけ。目・髪などのボーンとモーフはそのまま）
- Kimodo は毎フレームにキーを打つので、バックエンドで **キーフレームを間引き** ます（線形補間で再現できるキーを削除。各ボーンの最初と最後は残す）。
  強さは「キーフレームの間引き」で選択: なし / 弱（回転 0.5° / 移動 0.02）/ 標準（1° / 0.05、既定）/ 強（2° / 0.1）。
  Kimodo のサンプルモーションでは、標準でボーンキーが 35〜55% 程度になりました
- **日本語で入力**: Claude API のキーを設定すると「日本語で入力」欄が出ます。「英語に翻訳」で Kimodo 向けの英文（`A person ...`）がプロンプト欄に入り、確認・修正してから生成できます
  - `.env`（コミットしない）に `ANTHROPIC_API_KEY=...` を書いて `docker compose up -d`。モデルは `TRANSLATION_MODEL`（既定 `claude-opus-5-5`、例: `claude-haiku-5-5`）
  - 入力した文章は Anthropic の API に送られます
- 作成中のモーション名はプロンプトになります。`Ctrl+Enter` でも生成できます
- 生成は読み込み中のモデル（PMX）に合わせてリターゲットされた VMD（30 fps）として返ります

### Kimodo サーバーの起動

生成は [kimodopmx](https://github.com/re5kn/kimodopmx) の生成 API サーバー（`kimodo.scripts.run_generation_server`、ポート 9560）が行います。
GPU（VRAM 約 17GB、テキストエンコーダーを CPU にすれば数 GB）と Hugging Face のトークンが必要です。

```bash
cd ~/kimodo-docker/kimodopmx        # kimodopmx の clone 先
docker compose up -d generator      # text-encoder と generator が起動。初回はモデルのダウンロードで時間がかかります
curl localhost:9560/health          # "status": "ready" になれば準備完了

cd ~/mmd-kimodo
docker compose up -d --build        # 既定で http://host.docker.internal:9560 に接続
```

接続先は `KIMODO_URL=http://xxx:9560 docker compose up -d` で変えられます。画面の「KIMODO で生成」に接続状態（準備完了 / モデル読み込み中 / 接続できません）が出ます。
Kimodo デモ（7860）と同時に動かすと VRAM が足りない場合があります。

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
| GET | `/api/kimodo/status` | Kimodo サーバーの状態（`unconfigured` / `unreachable` / `loading` / `ready` / `error`） |
| POST | `/api/kimodo/translate` | JSON `{ text }`。日本語の動作説明を Kimodo 向けの英語プロンプトに翻訳（Claude API）して `{ prompt, model }` を返す |
| POST | `/api/kimodo/generate` | JSON `{ uploadId, pmxPath, prompt, duration, reduce? }`（`reduce`: `none` / `low` / `normal` / `high`）。Kimodo で生成し、モーション（`/api/motions` と同じ形）を返す |

座標は PMX のまま（左手系・Y 上・モデルは -Z 向き）で返し、フロントで Z 反転して three.js（右手系）に変換します。
ボーン計算は PMX 座標で行い、結果のローカル姿勢だけを変換しています。

## 開発

必要なもの: .NET SDK 10、Node.js 22

```bash
# バックエンド (http://localhost:5080)
cd backend
Kimodo__Url=http://localhost:9560 dotnet run --project src/MmdKimodo.Api
dotnet test

# フロントエンド (http://localhost:5173, /api は 5080 にプロキシ)
cd frontend
npm ci
npm run dev
npm test
```

アップロードされたファイルは一時ディレクトリ（Docker では `/data/uploads`）に保存され、新しいものから 8 件だけ残します（`Storage__MaxUploads`）。
