"use strict";

/* eslint-disable max-statements, no-magic-numbers */

const Player = require("./player");

class EnginePlayer extends Player {
  constructor(options) {
    super(options);
    this._engineIx = this._lastEngineIx = 0;
    this._engines = [].concat(options.engine);
    this.shuffleEngines();
    this._engine = this._engines[0];
  }

  get name() {
    const engines = this._engines.map(x => x.name).join(",");
    return `${super.name} (${engines})`;
  }

  allowTakeback() {
    return true;
  }

  shuffleEngines() {
    if (this._engines.length > 1) {
      for (let ix = 0; ix < this._engines.length; ix++) {
        const x = Math.floor(Math.random() * this._engines.length);
        const t = this._engines[x];
        this._engines[x] = this._engines[ix];
        this._engines[ix] = t;
      }
    }
  }

  async yourTurn(tryAgain) {
    try {
      await this.startTurn();
      // get move from engine
      const fen = this._game.fen();
      const updatePos = this._engines.map(eng => eng.position(fen));
      for (let ix = 0; ix < updatePos.length; ix++) {
        await updatePos[ix];
      }

      const engine = (this._engine = this._engines[this._engineIx]);
      const result = await engine.go({ depth: 1, multiPV: 10 }, this._game);

      this._result = result;

      this._lastEngineIx = this._engineIx;
      if (!tryAgain && this._engines.length > 1) {
        this._engineIx++;
        if (this._engineIx >= this._engines.length) {
          this._engineIx = 0;
        }
      }
      return { move: result.pickmove || result.bestmove, engine, engineResult: result };
    } finally {
      const minTime = this.minTime;
      if (minTime > 10) {
        await new Promise(resolve => {
          setTimeout(async () => {
            await this.endTurn();
            resolve();
          }, minTime);
        });
      }
    }
  }

  takeBack() {
    this._engineIx = this._lastEngineIx;
    super.takeBack();
  }
}

module.exports = EnginePlayer;
