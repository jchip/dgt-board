//
// Game maintains
// - A chess.js to validate and update moves
// - Two players
// - Game will switch back and forth to wait for move events from each
//   player in turn
// - A player can be an engine, which would wait for player to help move its
//   piece on the DGT board, validate it, and then let game know of its move
// - A player can also have a tutor engine, which helps analyze and offer
//   suggestions
// - If a real player wants to take back a move
// - If a real player made a move before making the engine's move on DGT, then
//   an flag is set.

const utils = require("./utils");
const chess = require("chess.js");
const protocol = require("./protocol.json");

class ChessGame {
  constructor({ board }) {
    this._board = board;
    this._chess = new chess.Chess();
    this._players = false;
  }

  newGame(initPlayer, startFen) {
    this._initPlayer = initPlayer;
    this._startFen = startFen || utils.defaultFen;
    const startRaw = utils.fenToRaw(this._startFen).join("");

    const waitStart = () => {
      const boardRaw = this._board.toString();
      if (boardRaw === startRaw) {
        console.log("board ready");
        this._board.removeListener("changed", waitStart);
        this.readyForNewGame();
        return true;
      } else {
        console.log("wait start", boardRaw, startRaw);
        return false;
      }
    };

    // wait for board to be in start position
    if (!waitStart()) {
      console.log("waiting for board positions to be ready");
      this._board.on("changed", waitStart);
    }
  }

  get turnColor() {
    return this._chess.turn() === this._chess.WHITE ? "white" : "black";
  }

  async syncBoard() {
    await this._board.commit();
  }

  async move(m) {
    let chessMove;
    if (typeof m === "string") {
      chessMove = {
        from: m.substr(0, 2),
        to: m.substr(2, 2)
      };
    } else {
      chessMove = {
        from: protocol.fields[m.from.index],
        to: protocol.fields[m.to.index]
      };
    }

    const legal = this._chess.move(chessMove);
    if (legal) {
      // tell board to commit
      // verify board
      console.log(this._chess.ascii());
    } else {
      // handle illegal move
    }

    return legal;
  }

  fen() {
    return this._chess.fen();
  }

  async play() {
    const move = await this._players[this.turnColor].yourTurn();
    process.nextTick(() => this.play());
  }

  async readyForNewGame() {
    this._board.reset();
    this._chess.load(this._startFen);
    const black = await this._initPlayer("black", this);
    const white = await this._initPlayer("white", this);
    this._players = { black, white };
    process.nextTick(() => this.play());
  }
}

module.exports = ChessGame;
