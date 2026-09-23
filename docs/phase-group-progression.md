# phaseGroup と ROUND ROBIN の進行仕様

この文書は、start.gg から取得した event snapshot を phaseGroup 単位で表示し、ローカル結果から次の phaseGroup へ進出させる処理の現在仕様をまとめたものです。

## 1. start.gg のデータ構造

start.gg では、次の関係でトーナメントを表します。

- `Event`
  - `Phase`
    - `PhaseGroup`
      - `seeds.nodes`
      - `sets.nodes`
- `PhaseGroup` は Pool や Bracket の単位です。
- `PhaseGroup.seeds.nodes` は、その phaseGroup に属するseedの一覧です。
- seedには entrant が割り当てられます。
- setには2つのslotがあり、slotにはseedとentrantが入ります。
- slotの `entrant` が `null` の場合、その対戦相手はまだ確定しておらず、対戦できません。
- DE/SEではset間の接続情報(source/progression)が存在します。ROUND ROBINではset間の接続を使わず、同じphaseGroup内の対戦表として扱います。

## 2. snapshot取得

取得は次の順序で行います。

1. eventのphase、phaseGroup、phaseGroupのseed一覧を取得する。
2. eventのset一覧からset IDを収集する。
3. set IDごとに詳細を取得する。
4. set詳細から次の値を保存する。
   - `set.phaseGroup.id`
   - `set.phaseGroup.phase`
   - `set.phaseGroup.displayIdentifier`
   - `set.slots[].seed`
   - `set.slots[].entrant`
   - `set.slots[].standing.stats.score`
   - entrant source、winner/loser progression
5. setの `phaseGroup.id` を `SetSnapshot.phaseGroupId` として保存する。

Poolの識別には、表示名やphaseOrderだけでなく、必ず `phaseGroup.id` を優先します。同じphaseOrderや似た表示名のPoolを混ぜないためです。

## 3. snapshot保存と読み込み

snapshotには用途の異なるファイルがあります。

- raw snapshot: start.ggから取得した復元用原本
- pristine snapshot: ローカル結果を適用する前の原本
- graph snapshot: Bracket表示用に加工した派生データ
- meta: 保留結果やローカル設定

通常の読み込みはraw snapshotを正本とします。graph snapshotは派生データであり、sourceや中間setを加工するため、rawが存在する場合のset表示には使いません。

読み込み時の進出再構築には次の制約があります。

- DE/SEのsetはsource/progressionを使って次のslotを更新する。
- ROUND ROBINのsetにはset間接続がないため、winner/loserのsource伝播を行わない。
- ROUND ROBINのslotは、他setのwinnerやloserによって上書きしない。

## 4. phaseGroup表示

UIでは、eventのsetを `set.phaseGroupId` 単位でグループ化します。

1. setにphaseGroup IDがある場合、そのIDに一致するphaseGroup metadataだけを使う。
2. IDがない旧データだけ、phaseOrder/displayIdentifierなどをfallbackに使う。
3. 選択したphaseGroupの `seeds.nodes` を列の正本にする。
4. seedNum順で列を並べる。
5. seed一覧が存在する場合、setから検出したentrantを列へ追加しない。
6. seed一覧が空の旧データだけ、set由来のentrant補完を許可する。

これにより、同じphaseOrderに複数Poolがある場合でも、Pool間のseedやsetが混ざりません。

## 5. ROUND ROBIN のマトリック

ROUND ROBINでは、列と行を同じphaseGroupのseed一覧から作ります。

### entrantの初期化

- `phaseGroup.seeds.nodes` の全seedを列として登録する。
- seedにentrantがあれば、そのentrantをstandingsへ初期登録する。
- setが未報告でも、standingsには勝敗0-0で表示する。
- placeholderやentrant未確定seedは、standingsの実entrantとして扱わない。

### setの表示

setの登録にはslot/sourceの解決結果を使います。seed IDが一致しない場合に備え、次の値を補助的に使います。

- seed ID
- `seedNum`
- `groupSeedNum`
- placement

表示用のsetは、slotが未確定でもマトリックに表示できます。対角成分は自分自身との対戦なので常に無効です。

### setの入力可否

表示と入力可否は分離します。

- slotが2つあるsetは閲覧できる。
- 両slotに実entrant IDがあるsetだけスコア入力できる。
- 片方でも `entrantId == null` の場合は入力不可。
- sourceやplaceholderからentrantを推定できても、slotのentrantがnullなら入力可能にはしない。
- 両entrantが揃ったsetは、DE/SEと同じset詳細UIでスコアを入力する。

### standings

standingsはsetを解決できたentrantだけではなく、phaseGroupのseed一覧を母集団にします。

1. phaseGroup seedから全entrantを登録する。
2. setのwinner/loserを登録済みentrantへ加算する。
3. 未報告setは勝敗0として扱う。
4. 同率時は対象phaseGroupの `tiebreakOrder` に記載されたルールを上から適用する。
5. `tiebreakOrder` が空の場合はset勝利数だけで比較する。
6. ルール適用後も同率なら、phaseGroup内のseedNumが小さい順にする。
7. phaseGroupの `progressionsOut` から次phaseへの進出枠を決める。

## 6. phaseGroup間の進出

ローカル結果からの進出は、phaseGroupのprogression単位で処理します。

1. phaseGroup内のset結果を確定する。
2. ROUND ROBINでは全setの結果が揃うまでstandingsを確定進出へ反映しない。
3. standingsと `progressionsOut.originPlacement` から進出順位を決める。
4. 進出先phaseGroupのseedから、該当する `progressionId` のseedを探す。
5. 進出entrantを対象seedへ割り当てる。
6. DE/SEでは進出先setのsource/progressionに従ってslotを更新する。
7. 次phaseのslotに両entrantが入ったsetだけ入力可能になる。

進出先の判定では、次の順でphaseGroupを限定します。

- event / phase ID
- phaseGroup ID
- progression ID
- origin phaseGroup ID
- origin placement / origin order

phaseOrderや表示名だけでphaseGroupを判定しないことが重要です。

## 7. 確定状態と表示

setの状態は次のように表示します。

- local pending resultが確定: 確定
- snapshotのsetが `state == 3` かつ `winnerId` あり: 確定
- winnerがなくscoreだけある: 進行中
- local pending resultが未確定: 下書き

snapshotのstateだけが完了でも、winnerIdがないsetは確定表示にしません。

## 8. 確認時のチェック項目

phaseGroupやROUND ROBINを確認する場合は、次を順番に確認します。

- 各setの `phaseGroupId` が対象Poolと一致しているか
- `phaseGroup.seeds.nodes` の件数と列数が一致しているか
- 各setのslotに異なるseedが割り当てられているか
- slotのentrantがnullなら入力不可になっているか
- standingsがset解決状況に関係なく全entrantを含んでいるか
- RR setのslotが他setのwinner/loserで上書きされていないか
- 進出先seedのprogression IDが正しいか
- 次phaseで両entrant確定後に入力可能になるか
