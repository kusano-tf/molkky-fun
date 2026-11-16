const tools = [
  {
    name: "モルック",
    role: "投げる棒",
    description: "スキットルを倒すために投げる木製の棒。基本は下手投げで使います。「モルック」は競技そのものの名前でもあります。",
  },
  {
    name: "スキットル",
    role: "倒すピン",
    description: "1〜12の数字が書かれた、12本の木製のピン。このアプリでは「ピン」と表示しています。1本だけ倒すとその数字、2本以上なら倒した本数が得点になります。",
  },
  {
    name: "モルッカーリ",
    role: "投げる位置の目印",
    description: "地面に置いて、モルックを投げる位置を示す道具。投げるときに触れたり、踏み越えたりすると反則になります。",
  },
];

export function MolkkyIntroduction() {
  return (
    <article className="app-guide molkky-introduction">
      <p className="glossary-intro">道具の名前、基本ルール、投げ方をひと通り。初めてのモルックに必要なことをまとめました。</p>
      <section aria-labelledby="glossary-tools">
        <h3 id="glossary-tools">まずは道具の名前から</h3>
        <dl className="glossary-tools">
          {tools.map((tool) => (
            <div key={tool.name}>
              <dt>{tool.name}<span className="glossary-role">{tool.role}</span></dt>
              <dd>{tool.description}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section aria-labelledby="intro-rules">
        <h3 id="intro-rules">基本ルール</h3>
        <ol className="intro-steps">
          <li><strong>並べて、順番を決める</strong><p>モルッカーリから3〜4mほど離して、12本を下の並びで寄せて立てます。個人やチームで、交代して投げましょう。</p></li>
          <li><strong>倒れたスキットルを数える</strong><p>1本だけなら書かれた数字が得点。2本以上なら本数が得点です。たとえば12番だけなら12点、3番と12番なら2点。ほかのスキットルにもたれ、完全に倒れていないものは数えません。</p></li>
          <li><strong>倒れた場所で立て直す</strong><p>得点を確認したら、その場で起こします。最初の並びには戻さず、広がっていく配置に合わせて次の狙いを考えます。</p></li>
          <li><strong>50点ぴったりで勝利</strong><p>合計が50点を超えると25点に戻ります。得点できない投球が3回続くと失格です。</p></li>
        </ol>
        <figure className="intro-pin-layout">
          <figcaption>最初の並べ方（投げる側から見た配置）</figcaption>
          {[[7, 9, 8], [5, 11, 12, 6], [3, 10, 4], [1, 2]].map((row, index) => (
            <div className="intro-pin-row" key={index}>{row.map((pin) => <span key={pin}>{pin}</span>)}</div>
          ))}
          <p>↑ この方向へ投げる</p>
        </figure>
      </section>
      <section aria-labelledby="intro-throws">
        <h3 id="intro-throws">投げ方の種類</h3>
        <p>まずは基本の下手投げから。慣れてきたら、狙いたいピンの並びに合わせて試してみましょう。</p>
        <dl>
          <dt>基本の下手投げ</dt>
          <dd>棒を横向きに持ち、腕を下から振って、ゆるい山なりに投げます。周囲に邪魔なピンがない場面で狙いやすい基本の形です。</dd>
          <dt>縦投げ</dt>
          <dd>棒を縦向きに持って投げる方法。横に並んだピンのうち、1本を狙いたい場面で使います。ピンのすぐ手前への着地を意識します。</dd>
          <dt>裏投げ</dt>
          <dd>逆手で握り、後ろ向きの回転を軽くかけて投げます。前後に並んだピンの1本を狙うときや、着地後に棒が動くのを抑えたいときに使います。</dd>
          <dt>ラハティ投げ</dt>
          <dd>低く構え、ピンの手前から転がすように強めに投げます。ピンを遠くへ動かしたいときに使えますが、地面によって跳ね方が変わります。</dd>
        </dl>
      </section>
      <section aria-labelledby="glossary-play">
        <h3 id="glossary-play">遊ぶときに出てくる言葉</h3>
        <dl>
          <dt>投擲（とうてき）・投球</dt>
          <dd>モルックを投げること。このアプリでは「投球」と呼び、1回投げることを「1投」と数えます。</dd>
          <dt>ミス（失投）</dt>
          <dd>スキットルを1本も倒せず、得点できないこと。3回連続すると失格になります。</dd>
          <dt>フォルト</dt>
          <dd>投げるときの反則。モルッカーリに触れたり、踏み越えたりした場合などで、その投球は0点になります。</dd>
          <dt>リーチ・あがり</dt>
          <dd>このアプリでは、あと1投で50点ぴったりを狙える残り1〜12点を「リーチ」、50点ぴったりにすることを「あがり」と呼んでいます。50点を超えると25点に戻ります。</dd>
          <dt>モルックアウト</dt>
          <dd>同点のときに勝敗を決める方法のひとつ。通常の試合とは異なる配置のスキットルを使い、得点を競います。</dd>
        </dl>
      </section>
      <p className="glossary-source">道具・ルール・投げ方の参考：<a href="https://molkky.jp/molkky/" target="_blank" rel="noreferrer">日本モルック協会「モルックについて」（外部サイト）</a></p>
    </article>
  );
}
