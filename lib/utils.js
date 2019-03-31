function fenToRaw(fen) {
  let rawX = 0;
  let fenX = 0;

  const raw = new Array(64);

  while (fenX < fen.length && rawX < 64) {
    const p = fen[fenX];
    if (p >= "1" && p <= "8") {
      const pn = p - "0";
      for (let k = 0; k < pn; k++) {
        raw[rawX++] = ".";
      }
    } else if (p !== "/") {
      raw[rawX++] = p;
    }
    fenX++;
  }

  return raw;
}

function rawToFen(raw) {
  let fen = "";
  let dotN = 0;
  let rawX = 0;

  for (let r = 0; r < 8; r++) {
    dotN = 0;

    for (let x = 0; x < 8; x++, rawX++) {
      const p = raw[rawX];
      if (p === ".") {
        dotN++;
      } else {
        if (dotN) {
          fen = fen + dotN;
          dotN = 0;
        }
        fen = fen + p;
      }
    }

    if (dotN) {
      fen = fen + dotN;
    }

    if (r < 7) {
      fen = fen + "/";
    }
  }

  return fen;
}

module.exports = {
  fenToRaw,
  rawToFen,
  defaultRaw: "rnbqkbnrpppppppp................................PPPPPPPPRNBQKBNR",
  defaultFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
};
