"use strict";

const Player = require("./player");

class UserPlayer extends Player {
  constructor(options) {
    super(options);
  }

  async yourTurn() {
    try {
      await this.startTurn();
      const move = await this.waitMove();
      return { move };
      // if (await this._game.move(move)) {
      //   await this._game.syncBoard(this._color);
      // } else {
      //   await this.yourTurn();
      // }
    } finally {
      await this.endTurn();
    }
  }
}

module.exports = UserPlayer;
