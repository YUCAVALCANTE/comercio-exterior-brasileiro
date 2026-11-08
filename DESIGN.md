# Design do painel Comex Brasil

A interface segue a composição de um observatório econômico. Os filtros ficam numa coluna de leitura, enquanto a mercadoria, a série histórica e os valores de referência ocupam o espaço principal. No celular, os filtros vêm antes da série.

| Token | Valor | Aplicação |
|---|---|---|
| Papel | `#f2eee5` | Fundo da página |
| Superfície | `#fcfaf4` | Filtros, gráficos e tabelas |
| Texto | `#2c3129` | Títulos, valores e dados |
| Texto secundário | `#595d50` | Períodos, unidades e fonte |
| Verde-oliva | `#435a40` | Ações, seleção e série observada em kg |
| Ameixa | `#6f5465` | Série observada em valor FOB no recorte aéreo |
| Terracota | `#9b4a32` | Projeção e leitura destacada de 2030 |
| Separador | `#d7cfc0` | Divisórias, limites de painéis e cartões |

- Títulos em Georgia. Controles e texto em fonte de sistema. Valores tabulares e eixo em fonte monoespaçada.
- Superfícies de papel, bordas finas e raio de 4 px. Indicadores alinhados em uma faixa, com divisórias.
- A série observada tem linha contínua. A projeção aérea tem traço interrompido e área levemente tingida. A legenda e a leitura por teclado informam o estado de cada ponto.
- Filtros com rótulos visíveis, foco de teclado e reorganização por largura de tela. Tabelas largas permitem rolagem horizontal.
