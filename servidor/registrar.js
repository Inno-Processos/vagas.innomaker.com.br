// Carregado com "node --import ./servidor/registrar.js": ensina o Node a importar os templates .html.
import { register } from "node:module";

register("./carregador.js", import.meta.url);
