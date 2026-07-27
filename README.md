# savakan-gg

start.gg で管理される大会のうち、1 イベント単位でローカルにミラーし、進行管理と結果報告を行う Tauri アプリです。

## このアプリでできること

- start.gg の tournament を slug 指定で同期し、イベント単位のワークスペースを作成
- 同期した進行状態をローカル JSON に保存
- ローカル保存済みスナップショットの再読込
- set 結果をまずローカルに記録し、必要なタイミングでまとめて start.gg に反映
- start.gg とローカルの差分を確認し、コンフリクト時はユーザが local / remote を選択
- 報告後に再同期してローカルとの整合を維持

## 技術スタック

- Frontend: React + TypeScript + Vite
- Desktop: Tauri v2
- Backend: Rust
- GraphQL Client: graphql-client

## start.gg API トークン

起動後、画面の「APIトークン設定」で start.gg API トークンを保存してください。

トークン発行ページ:

- https://start.gg/admin/profile/developer

API ドキュメント入口:

- https://developer.start.gg/docs/intro/

保存場所:

- app_data_dir/savakan-gg/startgg-token.txt
- app_data_dir/savakan-gg/last-slug.txt
- app_data_dir/savakan-gg/tournament-<slug>.json
- app_data_dir/savakan-gg/tournament-meta-<slug>-<eventId>.json

補足:

- 取り込み単位はイベントです。1 回に管理するのは 1 イベントを前提にしています。
- ローカル meta には、プレイサイド、使用キャラクター、メモ、ローカル認証コード、保留中の結果が保存されます。

## 使用手順

1. 依存関係をインストールしてアプリを起動する

```bash
npm install
npm run tauri dev
```

2. start.gg API トークンを保存する
- 画面「1. APIトークン設定」に token を入力し、保存を押す

3. tournament を同期する
- 画面「2. Tournament同期」に slug を入力
- 例: `tournament/sabakan-weekly-1`
- 必要に応じて sets per event を調整（初期値 200）
- 同期を押す
- 同期後、対象イベントを選択してそのイベントのワークスペースを扱う

4. ローカルスナップショットを読み込む
- 同じ slug のまま「ローカル読込」を押す
- ローカル読込もイベント単位で行われるため、対象イベントの選択が必要です

5. イベント単位で確認し、ブラケット風に見る
- 同期後の「対象イベント」で event を選択
- 選択イベント内の set がラウンドごとの列で表示される
- 列内カードの「この試合を報告対象に設定」で setId と winnerId 入力を補助

6. プレイヤーメタを記録する
- 各 entrant について、プレイサイド、使用キャラクター、メモを編集できる
- 「メタ保存」でイベント単位のローカル meta に保存される
- 保存した meta は同一イベントの次回読込でも利用される

7. 試合結果をローカルに記録する
- 画面「3. ローカル結果の記録」に setId / winnerId / scoreCsv を入力
- 例: scoreCsv は `3-1`
- 既に入力済みの試合を訂正する場合は「必要なら start.gg 側で reset してから反映する前提を保持する」をONにする
- 「ローカルに記録」を押すと、start.gg へは送らずローカルに保留される

8. 差分を確認して一括反映する
- 「start.ggとの差分を確認」を押すと、保留中のローカル結果と start.gg の差分が表示される
- コンフリクトがある場合は、各 set ごとに local / remote を選択する
- 「一括反映を実行」で、選択済みの方針に従ってまとめて反映する

9. 値の見つけ方
- setId: 同期後の試合カードに表示
- winnerId: 同カード内の entrantId を使用
- scoreCsv: 勝敗スコアをハイフン区切りで指定

## ローカルスナップショット

大会スナップショットは slug ごとに次のファイルへ保存されます。

- app_data_dir/savakan-gg/tournament-<slugを安全化した文字列>.json

イベント単位のローカル meta は次のファイルへ保存されます。

- app_data_dir/savakan-gg/tournament-meta-<slugを安全化した文字列>-<eventIdを安全化した文字列>.json

## 開発コマンド

```bash
npm install
npm run tauri dev
```

ビルド確認:

```bash
npm run build
cd src-tauri && cargo check
```

## 現状の実装範囲

- Query: Tournament + Event Sets の同期
- Mutation: reportBracketSet による結果報告
- ローカル保留結果の記録と、差分確認付きの一括反映

start.gg 側スキーマ変更時は、graphql ファイルと schema 定義を更新してください。
