---
description: "Rustでstart.gg向けのGraphQL操作を実装・変更するときに適用。graphql-clientクレート、型付きクエリ構造体、スキーマ準拠の.graphqlドキュメント利用を徹底する。"
name: "Rust GraphQLクライアント規約"
applyTo: ["src-tauri/src/**/*.rs", "src-tauri/src/graphql/**/*.graphql"]
---
# GraphQLクライアント規約 (Rust / start.gg)

## 1. 基本仕様
- GraphQL操作には https://github.com/graphql-rust/graphql-client.git の graphql-client クレートを使用する。
- HTTP呼び出しに手書きのGraphQL文字列や生のJSONペイロードを直接埋め込まない。必ず .graphql ドキュメントとスキーマから生成された型を使う。
- クエリ／ミューテーション定義は src-tauri/src/graphql/ 配下の .graphql ファイルで管理する。
- Rustコードでは GraphQLQuery derive から生成される Variables と型付きレスポンスデータを使用し、GraphQLレスポンスの serde_json::Value による無型パースを避ける。
- 新しいAPI操作を追加する場合は、既存の start.gg 実装と同じ構成（schema + document + generated types）に合わせる。
- 例外が避けられない場合は、コードコメントで理由を明記し、将来的に graphql-client ベースへ戻せる設計を維持する。

## 2. 参考にするUI/機能

- [tournament-manager](https://github.com/bodyscrap/tournament-manager.git)  
  - こちらのリポジトリはローカルにもcloneしてあるため必要であればそれを参照する。
  - E:\workspace\tournament-manager
- 画面構成はtournament-managerは基本的には参考にするが、start.ggの仕様に合わせて変更する。  
- ただし、イベントの管理機能はstart.ggに合わせるためtournament-managerの実装をそのまま流用しない。　
- start.ggのデータに含まれないメタ情報はローカルに対応するdbやjsonを用意して管理する。  
  - 各プレイヤーのプレイサイド(1P/2P)
  - 各プレイヤーの使用キャラクター
  - イベント完了後のキャラクター使用率などの統計情報
- start.ggであれば、イベントとプレイヤーの組み合わせが一意であるので、この単位で認証コードを発行する。  
  - この認証コードは、アプリド独自のローカルな認証コード
  - この認証コードリモートDQの通知を送る際に使用する(なりすまし防止)
- tournament-managerのローカル通信機能については実装するが詳細は別途詰める。
  - 他のクライアントへの呼び出しやDQ返信、汎用メッセージ送信が可能。
  - 同一イベントをハンドル中のクライアントが他にないかチェックする

## 3. 大会管理の構成

- [start.gg APIドキュメント](https://developer.start.gg/docs/intro/)
- ローカルにはstart.ggから取得したスナップショットを保存する。
  - 同期処理でローカルとリモートが異なる場合は、相違がある項目ごとに確認を行い、ローカルのスナップショットを更新する。
  - 同期処理完了後に、リモートを取り込まなかった項目がある場合は、確認の上でローカルスナップショットでリモートを上書きすることができる。
- イベント単位でスナップショットの取得および閲覧、結果報告が行える
- 現在のスナップショット及び、スナップショットからの変更差分を保持する
- start.gg側への結果報告は、基本的には同期処理を実行した時点で行う
  - クライアント内での勝敗結果適用はローカルのみに反映し、start.gg側には反映しない
  - 結果の一括報告(例えば一括報告用ボタン押下)実行時に、変更差分をstart.gg側に送信する
    - この際にトーナメントのマッチの深い順に送信することで結果に不整合が生じないようにする
  - マッチの結果報告手順は以下
    1. リモート側のマッチとローカル側のマッチのスナップショットの一致確認
    2. 一致していない場合はコンフリクト解消処理をする(リモートとローカルのどちらかを優先するかマッチ毎に選択)
    3. ローカルの結果が優先されるorローカル側がそのマッチの最初の報告の場合は結果を送信する
    4. リモートの結果を優先する場合は、一括報告モードを中断し、同期処理モードに遷移する
- start.ggはイベント名に2byte文字が使用できないので、ローカルスナップショットは2byte文字のエイリアスを持てるようにする。

## 4. クライアント間ローカル通信

- 基本的には[tournament-manager](https://github.com/bodyscrap/tournament-manager.git)を参考にする  
- 基本的にUDPブロードキャストで投げっぱなし
- 呼び出し機能
  - クライアントで進行中のマッチに対して行う
  - 定型返信が行える(不在、プレイ中、リモートDQ依頼)
  - 定型文に加えて通信欄を持ち短い自由文も付加できる
- 汎用メッセージ
  - 短文を送信できる。
  - 返信も可能。
- スレッド機能
  - メッセージとそれに対する返信のチェーンをスレッドとして保持できる
  - スレッド作成者はスレッドでの問題解決を通知できる
  - 同一マッチに対して複数のスレッドを作成した場合は古いスレッドは閉じられる

## 5. start.ggのsetのstate

|値 (Integer)|ステータス名|説明|
|:--|:--|:--|
|1|STANDBY|試合が開始されていない。マッチが決定していない状態も含む。|
|2|IN_PROGRESS|試合が開始され、現在プレイ中の状態。途中経過として現時点のスコアが入力されていることもある。|
|3|COMPLETED|試合が完了し勝敗が確定した状態。|

## 6. 参考文献

### 6.1. schemaのドキュメント

start.ggの公式のGraphQLスキーマのドキュメントは以下
https://smashgg-schema.netlify.app/reference/

ここに無いものは上記ライブラリにも存在しない。

### 6.2. brackets-manager.jsのドキュメント

bracketの作成ルールについて実装されている。
start.ggの形式に近づけようとしているようなので参考になるはず。  

https://github.com/Drarig29/brackets-manager.js/

## 7. start.gg とローカルスナップショットの整合を取るための実践知見

### 7.1. 取得戦略と複雑度制限

- start.gg の GraphQL は小規模トーナメントでも complexity 上限(1000)に到達することがある。
- event / tournament を一度に深く取得せず、次の順で分割取得する。
  - まず軽量クエリで set ID 群のみを収集する。
  - 次に set ごとの詳細クエリを順次実行して slots / source / score を取得する。
- complexity エラーが返った場合は perPage を段階的に縮小して再試行する。
- HTTP 429 / 5xx は retry + backoff + jitter で吸収し、Retry-After ヘッダがあれば尊重する。

### 7.2. スキーマとスカラー型の注意点

- start.gg の ID は文字列・整数が混在するため、スキーマ上の型を厳密に文字列固定すると JSON パースが失敗する。
- SetEntrantSource.typeId のような値は GgID (独自スカラー) で受け、Rust 側で必要に応じて String に正規化する。
- GraphQL レスポンスの Value 直パースに逃げず、schema.graphql と .graphql ドキュメントを更新して型で解決する。

### 7.3. Set 間接続の解決ルール

- 未確定スロット(TBD)の表示は推定を主とせず、Set.entrant1Source / entrant2Source の接続情報を優先する。
- Losers 側の表示ルールは次を基準にする。
  - 接続元が Winners の set なら loser of XX
  - 接続元が Losers の set なら winner of XX
- condition_string から set 記号を解決する際、contains の部分一致は誤マッチを生む。
  - 例: 1文字コード(E など)が無関係文字列に吸着する。
  - 英数字トークンの完全一致で照合する。
- typeId が set_id と一致しないケースがあるため、typeId 一致のみで接続元を判定しない。
  - condition / condition_string と set 記号の照合を併用する。

### 7.4. ローカル進行時の整合維持

- 片側だけ entrant が確定した中間状態では、カード座標を entrant 充足状況に依存させると表示がジャンプする。
- レーン座標は構造ベース(ラウンド列・接続構造)を優先し、1ソース判明時でも同一 set の表示位置が変わらないようにする。
- Losers Final 勝者の GF 編入は同一レーン探索だけでは取りこぼすことがある。
  - same-lane で編入先が見つからない場合、Grand Final へのクロスレーン編入フォールバックを持つ。

### 7.5. Grand Final Reset の表示運用

- データ構造上は GF Reset を最初から保持してよい。
- ただし表示は start.gg に合わせ、Reset 発生前は GF Reset 列を非表示にする。
- Reset 発生時にのみ Grand Final の右側に Grand Final Reset 列を表示する。
- GF と GF Reset は同一 round 値でも別ラウンドとして扱えるよう、列キーは round 値だけでなく round title も含めて分割する。

### 7.6. 検証観点

- 8人、12人(round2編入)、16人以上で以下を重点確認する。
  - Winners から Losers への落下時に loser of / winner of 表示が正しいか。
  - Losers 内の勝ち上がり接続が start.gg と一致するか。
  - GF Reset 後の逆転シナリオで、ローカル進行と start.gg 反映が破綻しないか。
