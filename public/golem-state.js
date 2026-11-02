export function normalizeGolemSettings(value = {}) {
  const size = Number(value.nodeSize);
  return {
    autoRotate: typeof value.autoRotate === 'boolean' ? value.autoRotate : true,
    nodeSize: Number.isFinite(size) && size >= 1 && size <= 5 ? size : 2,
  };
}

// Canvas dimensions survive GPU failures; only successful frames prove health.
export function createRenderState({now = () => performance.now(), onChange, staleAfterMs = 6000}) {
  let lastFrame = null, ready = false;
  function update(value, reason = '') {
    const changed = ready !== value;
    ready = value;
    if (changed || !value) onChange(value, reason);
  }
  return {
    frame() { lastFrame = now(); update(true); },
    fail(reason) { lastFrame = null; update(false, reason); },
    check() {
      if (ready && now() - lastFrame > staleAfterMs) update(false, '3D не отвечает — включена резервная карта');
      return ready;
    },
  };
}

const hash = (text, salt = 0) => {
  let value = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i++) { value ^= text.charCodeAt(i); value = Math.imul(value, 16777619); }
  return (value >>> 0) / 4294967296;
};

// Constellations must be this memory's own. Anything people already named is
// refused, and a name is invented from the region's own words instead.
const KNOWN_SKY = new Set((
  'андромеда,насос,райская птица,водолей,орёл,орел,жертвенник,овен,возничий,волопас,резец,жираф,рак,' +
  'гончие псы,большой пёс,малый пёс,большой пес,малый пес,козерог,киль,кассиопея,центавр,кентавр,цефей,кит,' +
  'хамелеон,циркуль,голубь,волосы вероники,южная корона,северная корона,ворон,чаша,южный крест,крест,лебедь,' +
  'дельфин,золотая рыба,дракон,малый конь,эридан,печь,близнецы,журавль,геркулес,часы,гидра,южная гидра,индеец,' +
  'ящерица,лев,малый лев,заяц,весы,волк,рысь,лира,столовая гора,микроскоп,единорог,муха,наугольник,октант,' +
  'змееносец,орион,павлин,пегас,персей,феникс,живописец,рыбы,южная рыба,корма,компас,сетка,стрела,стрелец,' +
  'скорпион,скульптор,щит,змея,секстант,телец,телескоп,треугольник,южный треугольник,тукан,большая медведица,' +
  'малая медведица,паруса,дева,летучая рыба,лисичка,ковш,большой ковш,пояс ориона,плеяды,летний треугольник,' +
  'andromeda,antlia,apus,aquarius,aquila,ara,aries,auriga,bootes,caelum,camelopardalis,cancer,canes venatici,' +
  'canis major,canis minor,capricornus,carina,cassiopeia,centaurus,cepheus,cetus,chamaeleon,circinus,columba,' +
  'coma berenices,corona australis,corona borealis,corvus,crater,crux,cygnus,delphinus,dorado,draco,equuleus,' +
  'eridanus,fornax,gemini,grus,hercules,horologium,hydra,hydrus,indus,lacerta,leo,leo minor,lepus,libra,lupus,' +
  'lynx,lyra,mensa,microscopium,monoceros,musca,norma,octans,ophiuchus,orion,pavo,pegasus,perseus,phoenix,' +
  'pictor,pisces,piscis austrinus,puppis,pyxis,reticulum,sagitta,sagittarius,scorpius,sculptor,scutum,serpens,' +
  'sextans,taurus,telescopium,triangulum,triangulum australe,tucana,ursa major,ursa minor,vela,virgo,volans,vulpecula'
).split(','));
export const isKnownConstellation = (name) =>
  KNOWN_SKY.has(String(name).trim().toLocaleLowerCase('ru').replace(/\s+/g, ' '));
const HEADS = ['Ал', 'Вен', 'Гел', 'Дор', 'Инн', 'Кор', 'Лиа', 'Мер', 'Нэй', 'Ори', 'Сель', 'Тар', 'Улл', 'Фен', 'Эск', 'Яр'];
const TAILS = ['вира', 'тея', 'мона', 'рида', 'сея', 'нара', 'лея', 'тара', 'нея', 'дора', 'сия', 'рона'];

export function inventConstellationName(words, salt = 0) {
  for (let attempt = 0; attempt < 24; attempt++) {
    const a = hash(words.join('|'), salt + attempt);
    const b = hash(words.join('~'), salt + attempt * 7 + 13);
    const name = HEADS[Math.floor(a * HEADS.length)] + TAILS[Math.floor(b * TAILS.length)];
    if (!isKnownConstellation(name)) return name;
  }
  return 'Безымянное';
}
export function constellationName(leader, words, salt = 0) {
  const direct = String(leader || '').trim();
  if (direct && !isKnownConstellation(direct)) return direct.length > 24 ? direct.slice(0, 23).trimEnd() + '…' : direct;
  return inventConstellationName(words, salt);
}
