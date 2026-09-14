import './ui/style.css';
import { Game } from './game/Game';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLElement;

const game = new Game(canvas, hud);
// Handy from the browser console (and from the headless smoke tests).
(window as unknown as { game: Game }).game = game;
game.run();
