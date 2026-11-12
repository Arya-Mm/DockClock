/**
 * Driver-facing strings in EN / ES / HI / PA (A10). Numbers are NEVER translated: every amount, time and count is
 * formatted here by code (USD, Latin digits, same string in every language) and inserted into a placeholder.
 * Templates carry no digits of their own; a test enforces both rules.
 */
export type Lang = "en" | "es" | "hi" | "pa";
export const LANGS: readonly Lang[] = ["en", "es", "hi", "pa"];
export const LANG_NAMES: Record<Lang, string> = { en: "English", es: "Español", hi: "हिन्दी", pa: "ਪੰਜਾਬੀ" };
/** BCP-47 tags for the Web Speech API. */
export const SPEECH_TAGS: Record<Lang, string> = { en: "en-US", es: "es-US", hi: "hi-IN", pa: "pa-IN" };

const T = {
  checkIn: { en: "Check in at the gate", es: "Registrarse en la puerta", hi: "गेट पर चेक-इन करें", pa: "ਗੇਟ 'ਤੇ ਚੈੱਕ-ਇਨ ਕਰੋ" },
  waiting: { en: "Waiting at {facility}", es: "Esperando en {facility}", hi: "{facility} पर इंतज़ार", pa: "{facility} 'ਤੇ ਉਡੀਕ" },
  minutes: { en: "minutes", es: "minutos", hi: "मिनट", pa: "ਮਿੰਟ" },
  freeTimeLeft: { en: "Free time ends in {min} min", es: "El tiempo libre termina en {min} min", hi: "मुफ़्त समय {min} मिनट में खत्म", pa: "ਮੁਫ਼ਤ ਸਮਾਂ {min} ਮਿੰਟ ਵਿੱਚ ਖ਼ਤਮ" },
  earning: { en: "Detention so far: {amount}", es: "Detención hasta ahora: {amount}", hi: "अब तक डिटेंशन: {amount}", pa: "ਹੁਣ ਤੱਕ ਡਿਟੈਂਸ਼ਨ: {amount}" },
  holdReady: { en: "Shipper hold ready: {amount}", es: "Retención del cargador lista: {amount}", hi: "शिपर होल्ड तैयार: {amount}", pa: "ਸ਼ਿਪਰ ਹੋਲਡ ਤਿਆਰ: {amount}" },
  offerTitle_WAIT_GUARANTEED: { en: "Guaranteed wait pay", es: "Pago de espera garantizado", hi: "गारंटीड इंतज़ार भुगतान", pa: "ਗਾਰੰਟੀਸ਼ੁਦਾ ਉਡੀਕ ਭੁਗਤਾਨ" },
  offerTitle_SLOT_SWAP_WITH_CREDIT: { en: "Earlier door with credit", es: "Puerta antes con crédito", hi: "क्रेडिट के साथ जल्दी डॉक", pa: "ਕ੍ਰੈਡਿਟ ਨਾਲ ਜਲਦੀ ਡੌਕ" },
  offerTitle_RELEASE_TONU: { en: "Leave now, get TONU", es: "Salir ahora y cobrar TONU", hi: "अभी जाएं, TONU पाएं", pa: "ਹੁਣੇ ਜਾਓ, TONU ਲਵੋ" },
  offerTitle_PRIORITY_SLOT_PURCHASE: { en: "Buy an earlier door", es: "Comprar una puerta antes", hi: "जल्दी डॉक खरीदें", pa: "ਜਲਦੀ ਡੌਕ ਖ਼ਰੀਦੋ" },
  offerTitle_PART_PURCHASE: { en: "Buy the missing part", es: "Comprar la pieza faltante", hi: "गायब पुर्ज़ा खरीदें", pa: "ਗੁੰਮ ਪੁਰਜ਼ਾ ਖ਼ਰੀਦੋ" },
  youGet: { en: "You get {amount}", es: "Usted recibe {amount}", hi: "आपको मिलेगा {amount}", pa: "ਤੁਹਾਨੂੰ ਮਿਲੇਗਾ {amount}" },
  youPay: { en: "You pay {amount}", es: "Usted paga {amount}", hi: "आप देंगे {amount}", pa: "ਤੁਸੀਂ ਦਿਓਗੇ {amount}" },
  door: { en: "Door {door} at {time}", es: "Puerta {door} a las {time}", hi: "डॉक {door}, समय {time}", pa: "ਡੌਕ {door}, ਸਮਾਂ {time}" },
  accept: { en: "Accept", es: "Aceptar", hi: "स्वीकार करें", pa: "ਮਨਜ਼ੂਰ ਕਰੋ" },
  decline: { en: "Decline", es: "Rechazar", hi: "मना करें", pa: "ਇਨਕਾਰ ਕਰੋ" },
  confirmTitle: { en: "Confirm {amount}?", es: "¿Confirmar {amount}?", hi: "{amount} पक्का करें?", pa: "{amount} ਪੱਕਾ ਕਰੋ?" },
  confirmYes: { en: "Yes, confirm", es: "Sí, confirmar", hi: "हाँ, पक्का करें", pa: "ਹਾਂ, ਪੱਕਾ ਕਰੋ" },
  confirmBack: { en: "Go back", es: "Volver", hi: "वापस जाएं", pa: "ਵਾਪਸ ਜਾਓ" },
  heard: { en: "Heard: \"{text}\"", es: "Escuché: \"{text}\"", hi: "सुना: \"{text}\"", pa: "ਸੁਣਿਆ: \"{text}\"" },
  speak: { en: "Say accept or decline", es: "Diga aceptar o rechazar", hi: "स्वीकार या मना बोलें", pa: "ਮਨਜ਼ੂਰ ਜਾਂ ਇਨਕਾਰ ਬੋਲੋ" },
  typeInstead: { en: "Type instead", es: "Escribir en su lugar", hi: "लिखकर बताएं", pa: "ਲਿਖ ਕੇ ਦੱਸੋ" },
  departed: { en: "You left the dock. Settling now.", es: "Salió del muelle. Liquidando ahora.", hi: "आप डॉक से निकल गए। भुगतान हो रहा है।", pa: "ਤੁਸੀਂ ਡੌਕ ਤੋਂ ਨਿਕਲ ਗਏ। ਭੁਗਤਾਨ ਹੋ ਰਿਹਾ ਹੈ।" },
  paid: { en: "Paid {amount}", es: "Pagado {amount}", hi: "भुगतान {amount}", pa: "ਭੁਗਤਾਨ {amount}" },
  paidPending: { en: "Payout sent: {amount}", es: "Pago enviado: {amount}", hi: "भुगतान भेजा: {amount}", pa: "ਭੁਗਤਾਨ ਭੇਜਿਆ: {amount}" },
  noDetention: { en: "No detention owed on this stop", es: "No se debe detención en esta parada", hi: "इस स्टॉप पर कोई डिटेंशन नहीं", pa: "ਇਸ ਸਟਾਪ 'ਤੇ ਕੋਈ ਡਿਟੈਂਸ਼ਨ ਨਹੀਂ" },
  review: { en: "A person is checking the times", es: "Una persona está revisando los horarios", hi: "एक व्यक्ति समय जाँच रहा है", pa: "ਇੱਕ ਵਿਅਕਤੀ ਸਮਾਂ ਜਾਂਚ ਰਿਹਾ ਹੈ" },
  receipt: { en: "Open receipt", es: "Abrir recibo", hi: "रसीद खोलें", pa: "ਰਸੀਦ ਖੋਲ੍ਹੋ" },
  findPart: { en: "Find the missing part", es: "Buscar la pieza faltante", hi: "गायब पुर्ज़ा खोजें", pa: "ਗੁੰਮ ਪੁਰਜ਼ਾ ਲੱਭੋ" },
  noPartMissing: { en: "The gate camera shows nothing missing", es: "La cámara de la puerta no muestra nada faltante", hi: "गेट कैमरा में कुछ गायब नहीं दिखा", pa: "ਗੇਟ ਕੈਮਰੇ ਵਿੱਚ ਕੁਝ ਗੁੰਮ ਨਹੀਂ ਦਿਸਿਆ" },
  buyFor: { en: "Buy for {amount}", es: "Comprar por {amount}", hi: "{amount} में खरीदें", pa: "{amount} ਵਿੱਚ ਖ਼ਰੀਦੋ" },
  offline: { en: "No signal. Your clock keeps running.", es: "Sin señal. Su reloj sigue corriendo.", hi: "सिग्नल नहीं। आपकी घड़ी चल रही है।", pa: "ਸਿਗਨਲ ਨਹੀਂ। ਤੁਹਾਡੀ ਘੜੀ ਚੱਲ ਰਹੀ ਹੈ।" },
} as const satisfies Record<string, Record<Lang, string>>;

export type MsgKey = keyof typeof T;
export const MESSAGES: Record<MsgKey, Record<Lang, string>> = T;

/** The only number formatters drivers see. Same output in every language. */
export const fmtUsd = (cents: number) => `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;
export const fmtInt = (n: number) => String(Math.trunc(n));
export const fmtClock = (ms: number, zone: string) => new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(ms);

export type Vars = Record<string, string>;
/** Fill a template. Missing variables throw, so a broken translation cannot silently drop an amount. */
export function t(key: MsgKey, lang: Lang, vars: Vars = {}): string {
  return MESSAGES[key][lang].replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = vars[k];
    if (v === undefined) throw new Error(`i18n ${key}/${lang}: missing {${k}}`);
    return v;
  });
}

/** Voice intent from a transcript in any supported language. Only two outcomes; anything else asks again. */
const YES = /\b(accept|yes|ok|okay|acepto|aceptar|sí|si)\b|स्वीकार|हाँ|हां|ठीक|ਮਨਜ਼ੂਰ|ਹਾਂ|ਠੀਕ/i;
const NO = /\b(decline|no|reject|rechazar|rechazo)\b|मना|नहीं|ਇਨਕਾਰ|ਨਹੀਂ/i;
export function voiceIntent(transcript: string): "ACCEPT" | "DECLINE" | null {
  const y = YES.test(transcript), n = NO.test(transcript);
  return y === n ? null : y ? "ACCEPT" : "DECLINE"; // both or neither: ambiguous, never guess (A9)
}
