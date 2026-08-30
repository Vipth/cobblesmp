/**
 * Convert a string with legacy `&`/`§` colour codes into an array of tellraw
 * text components.
 *
 *   ampToComponents('&6[&cBroadcast&6]')
 *   -> [ {text:'[',color:'gold'}, {text:'Broadcast',color:'red'}, {text:']',color:'gold'} ]
 *
 * Colour codes reset styling (matching Minecraft); style codes stack; &r resets.
 * Unknown codes are kept literally.
 */

const COLORS = {
  0: 'black', 1: 'dark_blue', 2: 'dark_green', 3: 'dark_aqua', 4: 'dark_red',
  5: 'dark_purple', 6: 'gold', 7: 'gray', 8: 'dark_gray', 9: 'blue',
  a: 'green', b: 'aqua', c: 'red', d: 'light_purple', e: 'yellow', f: 'white',
};

const STYLES = { l: 'bold', o: 'italic', n: 'underlined', m: 'strikethrough', k: 'obfuscated' };

export function ampToComponents(input, defaultColor = 'white') {
  const out = [];
  let text = '';
  let style = { color: defaultColor };

  const push = () => {
    if (text) out.push({ text, ...style });
    text = '';
  };

  const str = String(input ?? '');
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const next = str[i + 1];
    if ((ch === '&' || ch === '§') && next) {
      const code = next.toLowerCase();
      if (code === 'r') {
        push();
        style = { color: defaultColor };
        i++;
        continue;
      }
      if (COLORS[code]) {
        push();
        style = { color: COLORS[code] };
        i++;
        continue;
      }
      if (STYLES[code]) {
        push();
        style = { ...style, [STYLES[code]]: true };
        i++;
        continue;
      }
      // unknown code: fall through and keep '&' literal
    }
    text += ch;
  }
  push();

  return out.length ? out : [{ text: '', color: defaultColor }];
}
