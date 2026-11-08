# Design do painel Comex Brasil

A interface usa hierarquia tipográfica, superfícies discretas e controles nativos. A referência é a orientação de simplicidade, consistência e uso semântico de cor das diretrizes da Apple. [Princípios de design](https://developer.apple.com/design/human-interface-guidelines/design-principles) · [Cor](https://developer.apple.com/design/human-interface-guidelines/color)

| Token | Valor | Aplicação |
|---|---|---|
| Plano de fundo | `#f5f5f7` | Área de trabalho |
| Superfície | `#ffffff` | Gráficos, filtros e tabelas |
| Texto | `#1d1d1f` | Títulos, valores e dados |
| Texto secundário | `#515154` | Descrições, unidades e fonte |
| Ação | `#0066cc` | Links, seleção e foco |
| Separador | `#d2d2d7` | Divisórias e limites de controles |
| Séries | `#0066cc`, `#7150a5`, `#246957` | Exportações, importações e saldo nacional |

- Tipografia de sistema e números tabulares para facilitar a comparação. Títulos entre 36 e 56 px, títulos de seção entre 22 e 27 px e texto entre 14 e 16 px.
- Espaçamento em múltiplos de 4 px, com superfícies brancas, bordas finas e raio de 12 px.
- Navegação de duas visões na mesma página. Filtros mantêm rótulos visíveis e foco de teclado. A projeção usa traço interrompido, com legenda e estado explícito na leitura de cada ponto.
- A hierarquia se mantém no celular. Os filtros reorganizam em colunas e as tabelas permitem rolagem horizontal.
