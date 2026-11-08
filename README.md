# Comércio exterior brasileiro até 2030

**[Abrir o painel do TCC](https://yucavalcante.github.io/comercio-exterior-brasileiro/)**

O projeto compara modelos de previsão para o comércio de bens do Brasil. O painel apresenta exportações, importações e saldo anual em US$ FOB nominais. A análise detalhada por país, UF e produto permanece disponível no painel local.

## Questão de pesquisa

Qual modelo projeta com menor erro o valor anual das exportações e importações brasileiras de bens em diferentes horizontes, e qual trajetória ele indica até 2030?

## Protocolo de previsão

1. **Série nacional mensal.** Totais do módulo Dados Gerais do Comex Stat desde janeiro de 1997. A série publicada neste repositório contém apenas totais nacionais mensais. A coleta divide o período em blocos e exige cobertura contínua nos dois fluxos.
2. **Modelos.** O ingênuo sazonal repete os últimos 12 meses. O Holt-Winters usa tendência amortecida e sazonalidade de 12 meses no log do valor. A regressão log-linear estima uma tendência e efeitos mensais em uma janela fixa de 120 meses. As projeções no log são convertidas por exponenciação e interpretadas como estimativas centrais.
3. **Validação temporal.** Cada origem treina somente com os meses até o corte daquele ano. O mês de corte reproduz o da projeção publicada. Para um ano parcialmente observado, a estimativa anual soma os meses já observados às previsões dos meses restantes.
4. **Seleção e teste.** A seleção por fluxo minimiza a média do WAPE anual por horizonte, excluindo a estimativa do próprio ano de corte. Usam-se anos-alvo até 2018 na seleção e anos-alvo posteriores no teste. O WAPE divide a soma dos erros absolutos pela soma dos valores observados. O CSV de validação também registra o erro absoluto médio (MAE), o viés agregado e o número de origens.
5. **Faixas de projeção.** Os erros relativos históricos são aplicados à parcela ainda projetada no horizonte equivalente. A faixa usa o percentil 80 da magnitude dos erros em torno da estimativa central. Para o saldo, os cenários de exportação e importação são pareados pela origem antes da subtração. O limite inferior de cada fluxo respeita o valor já observado no ano. O painel mostra o número de erros usado. As faixas são empíricas, com amostras pequenas e horizontes sobrepostos.

O teste usa a edição atual da série, sujeita a revisões retroativas do MDIC. As estimativas extrapolam padrões históricos de valores nominais e não incorporam variáveis externas como câmbio, tarifas, preços de commodities ou choques futuros.

[Comex Stat](https://comexstat.mdic.gov.br/pt/home) · [API oficial](https://api-comexstat.mdic.gov.br/docs) · [Hyndman e Athanasopoulos, *Forecasting: Principles and Practice*, 3ª ed.](https://otexts.com/fpp3/)

### Resultados com o corte de outubro de 2026

Foram conferidos **358 meses**, incluindo os 36 meses em comum com o banco DuckDB. Em 2026, a estimativa anual combina janeiro a outubro observados com novembro e dezembro projetados. Os anos seguintes são inteiramente projetados.

| Indicador em 2030 | Valor central (US$ bi FOB) | Faixa empírica (US$ bi FOB) | Modelo |
|---|---:|---:|---|
| Exportações | 380,8 | 186,7 a 574,8 | Ingênuo sazonal |
| Importações | 317,8 | 180,3 a 455,2 | Holt-Winters amortecido |
| Saldo | 63,0 | 12,8 a 113,2 | Exportações menos importações |

No teste de quatro anos à frente, os modelos selecionados tiveram WAPE de **27,0%** para exportações e **26,8%** para importações, com **sete origens** por fluxo. O viés foi de **−27,0%** e **−26,8%**, respectivamente. O ingênuo sazonal produz o mesmo total para os anos completos futuros, porque repete os valores dos últimos 12 meses observados.

### Reproduzir a projeção

Com o ambiente Python deste repositório instalado, o arquivo de entrada já está em [docs/dados/historico-mensal.csv](docs/dados/historico-mensal.csv).

```powershell
& .\.venv\Scripts\python.exe -B projecao.py
& .\.venv\Scripts\python.exe -B -m http.server 8510 --bind 127.0.0.1 --directory docs
```

Abra `http://127.0.0.1:8510` para ver a versão local. Para atualizar o histórico, execute `forecast_data.py` antes de `projecao.py`. A validação por fluxo, modelo e horizonte está em [docs/dados/validacao.csv](docs/dados/validacao.csv), e os resultados anuais estão em [docs/dados/projecao-anual.csv](docs/dados/projecao-anual.csv).

## Análise exploratória detalhada

Estudo reproduzível sobre a balança comercial de bens do Brasil. O projeto consulta dados oficiais do Comex Stat, valida as agregações com dbt e entrega um painel interativo em Streamlit sobre DuckDB.

## Perguntas

- Como evoluíram as exportações, importações e o saldo comercial nos anos analisados?
- Quais países parceiros, UFs e capítulos de produtos mais contribuíram para cada fluxo?
- Qual é a participação do principal parceiro e como mudou a concentração por país?

## Base e metodologia

A extração usa o módulo **Dados Gerais** da API Comex Stat, da SECEX/MDIC. O recorte padrão inclui **2023 a 2025**, com os 12 meses de cada ano para ambos os fluxos. A unidade de observação é **mês × fluxo × país parceiro × UF do produto × capítulo do Sistema Harmonizado**.

- **Valor** em dólares correntes, pelo critério FOB, para os dois fluxos. O saldo é exportação menos importação. A corrente de comércio é a soma dos fluxos.
- **Peso líquido** em kg, disponível no ranking. A análise agrega produtos no nível de capítulo SH.
- **País parceiro** corresponde ao destino na exportação e à origem na importação. A **UF do produto** segue a classificação do módulo Dados Gerais. Esse recorte é distinto do domicílio fiscal da empresa, usado no módulo por municípios.
- **Variação anual** é calculada sobre o valor nominal do ano civil anterior. O **HHI** soma os quadrados das participações dos países no valor de cada fluxo. É um indicador descritivo de concentração, medido de 0 a 1.
- Os resultados podem mudar com revisões da fonte. Comparações nominais combinam efeitos de preço, volume e composição e, por si só, não estabelecem causalidade.

Fontes oficiais [Comex Stat](https://comexstat.mdic.gov.br/pt/home) · [Documentação da API](https://api-comexstat.mdic.gov.br/docs) · [Metadados dos dados abertos](https://www.gov.br/mdic/pt-br/assuntos/comercio-exterior/estatisticas/base-de-dados-bruta).

## Resultados de 2023 a 2025

O banco contém **1.360.656 registros agregados** em **36 meses**. Os 15 testes do dbt passaram, incluindo a conferência dos totais mensais de valor e peso para ambos os fluxos.

| Ano | Exportações (US$ bi FOB) | Importações (US$ bi FOB) | Saldo (US$ bi FOB) |
|---|---:|---:|---:|
| 2023 | 339,7 | 240,8 | 98,9 |
| 2024 | 337,0 | 262,9 | 74,2 |
| 2025 | 348,3 | 280,2 | 68,1 |

Em 2025, o valor das exportações cresceu **3,3%** e o das importações **6,6%** frente a 2024. O saldo comercial caiu de **US$ 98,9 bilhões** em 2023 para **US$ 68,1 bilhões** em 2025. [Série consolidada da SECEX/MDIC](https://balanca.mdic.gov.br/balanca/publicacoes_dados_consolidados/pg.html)

A **China** liderou os dois fluxos nos três anos. Sua participação nas importações passou de **22,1%** em 2023 para **25,3%** em 2025, e o HHI desse fluxo subiu de **0,087** para **0,102**. Nas exportações, a participação chinesa recuou de **30,7%** para **28,7%** e o HHI de **0,116** para **0,104** no mesmo período.

Os capítulos com maior valor exportado em 2025 foram **combustíveis minerais (27)**, com **US$ 56,0 bilhões**, **sementes e frutos oleaginosos e outros produtos do capítulo 12**, com **US$ 44,7 bilhões**, e **minérios, escórias e cinzas (26)**, com **US$ 34,9 bilhões**.

### Cobertura do detalhamento

Para três diferenças em 2025, a consulta por país e UF confirmou os valores abaixo. Eles compõem os totais e os recortes de país e UF sob a categoria **Capítulo não detalhado pela API**.

| Mês | Fluxo | País | UF | Valor (US$ FOB) | Peso (kg) |
|---|---|---|---|---:|---:|
| 08/2025 | Exportação | Guiana | Amazonas | 4.822 | 5.000 |
| 08/2025 | Importação | Estados Unidos | São Paulo | 150 | 0 |
| 12/2025 | Exportação | Libéria | Maranhão | 1.333 | 189 |

## Pipeline

```text
API Comex Stat
  ├── Dados mensais detalhados ──► cache JSON.gz ──► raw.trade
  └── Totais mensais nacionais ──► cache JSON.gz ──► raw.totals
                                                       │
                                    dbt build + testes de reconciliação
                                                       │
                                    fatos e indicadores em DuckDB
                                                       │
                                             painel Streamlit
```

A extração divide as consultas detalhadas por trimestre. Se houver divergência, repete a consulta no mês afetado e verifica os agrupamentos de país e UF sem o capítulo. Diferenças positivas confirmadas ficam em categorias explícitas de detalhamento indisponível, com as dimensões que a API permite identificar. Divergências incompatíveis interrompem a carga. As respostas são mantidas em cache local para retomar a execução. O banco validado substitui o anterior após o sucesso dos testes de cobertura mensal, valores, chaves e igualdade de FOB e peso com a consulta nacional por mês e fluxo.

| Modelo | Conteúdo |
|---|---|
| `stg_trade` | Contrato das colunas de entrada |
| `fct_trade` | Fato mensal com os recortes de país, UF e produto |
| `mart_monthly` | Série nacional mensal de exportações, importações e saldo |
| `mart_annual` | Valor anual, variação, principal parceiro, participação e HHI por fluxo |

## Como executar no Windows

Requer Python 3.13 e acesso HTTPS à API do Comex Stat. Execute no PowerShell, na pasta do projeto. O ambiente, os temporários, o cache e o banco são gravados dentro dessa pasta.

```powershell
Set-Location 'D:\comercio-exterior-brasileiro'
$env:TEMP = (New-Item -Path '.tmp' -ItemType Directory -Force).FullName
$env:TMP = $env:TEMP
$env:PIP_CACHE_DIR = Join-Path $env:TEMP 'pip-cache'
python -m venv .venv
& .\.venv\Scripts\python.exe -m pip install --timeout 60 -r requirements.txt
& .\.venv\Scripts\python.exe -B pipeline.py
& .\.venv\Scripts\python.exe -B -m streamlit run app.py --server.address 127.0.0.1
```

Depois da configuração, dê duplo clique em [abrir-painel.cmd](abrir-painel.cmd) ou use o último comando para abrir o painel em `http://127.0.0.1:8501`. O painel cruza país, UF e capítulo, mostra rankings por valor ou peso e permite baixar a série mensal filtrada. A aba **Concentração** mostra indicadores nacionais para os anos selecionados.

Para alterar o período, passe `--years 2024 2025` ao pipeline. Use `--refresh` para consultar a fonte novamente. Encerre o painel antes de atualizar o banco no Windows.

```powershell
& .\.venv\Scripts\dbt.exe test --profiles-dir .
```

Os dados, o ambiente virtual e os artefatos gerados ficam fora do controle de versão.
