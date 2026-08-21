# 우리동네 폭염 미래 실험실

폭염의 원인과 일상 행동의 영향을 게임, AI 예측, 지역 자료, 퀴즈로 살펴보는 교육용 웹 프로젝트입니다. 별도 설치나 회원가입 없이 브라우저에서 실행되며, 차트·지도·글꼴·예측 모델을 프로젝트 안에 포함해 인터넷 연결 없이도 사용할 수 있습니다.

## 바로 실행하기

가장 간단한 방법은 프로젝트 폴더의 `index.html`을 브라우저로 여는 것입니다.

개발하거나 브라우저의 보안 제한 없이 확인하려면 프로젝트 폴더에서 로컬 서버를 실행합니다.

```bash
python3 -m http.server 8000
```

그다음 브라우저에서 `http://localhost:8000`을 엽니다. 화면을 보는 데는 패키지 설치나 빌드 과정이 필요하지 않습니다.

## 사용 흐름

| 순서 | 파일 | 화면 | 역할 |
|---|---|---|---|
| 시작 | `index.html` | 홈 | 프로젝트의 목적과 4개 주요 화면으로 이동하는 카드 표시 |
| 1 | `game.html` | 우리동네 기후 게임 | 지역을 고르고 하루의 행동을 5번 선택해 2070년대 폭염 변화를 확인 |
| 2 | `mylab.html` | 내가 만드는 미래 | CO₂와 습도를 조절하고 AI 예측값과 공식 전망을 그래프로 비교 |
| 3 | `search.html` | 우리 지역 보기 | 지도에서 지역을 선택해 주요 수치, 변화 추이, 지역 순위를 한 화면에서 확인 |
| 4 | `guide.html` | 개념 정리 | 폭염 개념과 게임 선택을 정리하고 일반 기후 지식 퀴즈 풀이 |

지역, 연대, CO₂ 슬라이더 위치, 습도 조절값은 주소의 해시와 브라우저 저장소에 보관됩니다. 페이지를 이동해도 같은 조건이 이어집니다. 게임을 마치면 선택 기록도 저장되어 `guide.html`의 맞춤 정리에 사용됩니다.

## 자료 범위

프로젝트에는 목적이 다른 두 지역 데이터 묶음이 있습니다.

| 구분 | 사용 화면 | 지역 |
|---|---|---|
| 공통·AI 데이터 | 게임, 내가 만드는 미래, 개념 정리 | 전국, 서울, 부산, 대전, 속초, 천안 등 6개 |
| 지역 조회 데이터 | 우리 지역 보기 | 공통 6개 + 대구, 인천, 광주, 울산, 세종, 제주 등 12개 |

자료는 2000·2010년대 현재기후 관측값과 2020~2090년대 전망값으로 구성됩니다. 화면의 변화 비교 기준은 2010년대입니다. AI 모델은 지역의 기후 특성을 나타내는 입력값으로 2000년대 관측값을 사용합니다.

기본 전망은 SSP1-2.6입니다. 기본 CSV에 SSP1-2.6 절대습도가 없어 절대습도 항목은 SSP2-4.5 자료를 사용합니다. 천안은 여름 체감온도 자료가 없어 해당 값을 임의로 만들지 않고 비어 있는 상태로 처리합니다.

## 전체 구조

```text
.
├── index.html, game.html, mylab.html, search.html, guide.html
├── css/
│   ├── style.css
│   └── fonts/PretendardVariable.woff2
├── data/
│   ├── CO2.csv, Humidity.csv, Temperature.csv
│   ├── air temperature.csv, heat wave.csv
│   └── *_SSP시나리오_통합지표_연대별*.csv
├── js/
│   ├── data.js, search-data.js, model.js
│   ├── climate.js, common.js, predict.js
│   ├── page-home.js, game-data.js, game.js
│   ├── mylab.js, app.js, guide.js
│   └── vendor/plotly.min.js, vendor/geo-asia.js
├── tools/
│   ├── build_data.py, build_search_data.py
│   ├── train_model.py, eval_model.py
│   └── check_game.js
├── README.md
├── FRONTEND_PROMPT.md, BACKEND_PROMPT.md
└── XGBOOST.md
```

## 구현 재현 프롬프트

- [BACKEND_PROMPT.md](BACKEND_PROMPT.md): 기존 CSV를 브라우저 데이터와 XGBoost 모델로 변환하고 공통 로직·게임 판정을 구현하는 프롬프트
- [FRONTEND_PROMPT.md](FRONTEND_PROMPT.md): 5개 화면의 문구, 레이아웃, 지도·그래프·게임·퀴즈 상호작용을 구현하는 프롬프트

CSV만 있는 상태에서 전체 프로젝트를 다시 만들 때는 백엔드·로직 프롬프트를 먼저 실행하고 프론트엔드 프롬프트를 이어서 실행한다.

## 코드 설명

### 공통 코드

| 파일 | 책임 |
|---|---|
| `css/style.css` | 5개 화면의 공통 레이아웃, 반응형 스타일, 페이지별 UI 스타일 |
| `js/common.js` | 지역·연대·슬라이더 상태 저장, 내부 링크 갱신, 메뉴, 이전·다음 이동 |
| `js/climate.js` | 폭염위험지수, 등급, 체감온도 예시, 숫자 표시, 한국어 조사 처리 |
| `js/predict.js` | CO₂ 경로 보간과 브라우저용 XGBoost 트리 순회 |
| `js/vendor/plotly.min.js` | 차트와 지도 렌더링용 Plotly.js 2.35.2 |
| `js/vendor/geo-asia.js` | 오프라인 지도 배경 데이터 |

### 화면별 코드

| 화면 | 실행 코드 | 주요 내용 |
|---|---|---|
| 홈 | `js/page-home.js` | `common.js`의 페이지 목록으로 이동 카드 생성 |
| 게임 | `js/game-data.js`, `js/game.js` | 5개 상황·20개 행동 자료, 점수 계산, 예측 연결, 선택 지역 지도 표현 |
| 내가 만드는 미래 | `js/mylab.js` | CO₂·습도 입력, 예측 그래프, 관측·공식 전망·사용자 선택 비교 |
| 우리 지역 보기 | `js/app.js` | 12개 지역 지도 선택, 지표 카드, 추이 그래프, 순위표 갱신 |
| 개념 정리 | `js/guide.js` | 개념 주제, 게임 기록 복습, 일반 폭염·기후 퀴즈와 정답 피드백 |

### 생성 파일

다음 파일은 원본이 아니라 생성 결과이므로 직접 수정하지 않습니다.

| 생성 파일 | 만드는 도구 | 입력 |
|---|---|---|
| `js/data.js` | `tools/build_data.py` | 기본 CSV 5종, 공통 6개 지역 |
| `js/search-data.js` | `tools/build_search_data.py` | 기본 CSV 5종과 통합지표 CSV, 조회용 12개 지역 |
| `js/model.js` | `tools/train_model.py` | 기본 CSV의 SSP 4개 경로, 6개 지역, 2020~2090년대 |

브라우저에서 CSV를 직접 불러오지 않는 이유는 `file://`로 열었을 때 발생할 수 있는 파일 접근 제한을 피하고 오프라인 실행을 보장하기 위해서입니다.

## 데이터 흐름

```text
기본 CSV 5종 ── build_data.py ──> js/data.js ──> 게임·실험실·개념 정리
       │
       ├── train_model.py ──────> js/model.js ── predict.js ──> 게임·실험실
       │
       └── 통합지표 CSV + build_search_data.py ──> js/search-data.js ──> 지역 보기
```

`common.js`는 `climate-condition`이라는 브라우저 저장소 키를 사용합니다. `game.js`는 완료한 게임을 `climate-game-review`에 저장합니다. 저장이 차단된 환경에서도 현재 화면은 동작하지만 페이지 간 상태 연결은 유지되지 않을 수 있습니다.

## 자료 갱신

기본 CSV를 바꾼 뒤 공통 화면 데이터를 다시 만듭니다.

```bash
PYTHONDONTWRITEBYTECODE=1 python3 tools/build_data.py
```

통합지표 CSV를 추가하거나 수정한 뒤 지역 조회 데이터를 다시 만듭니다.

```bash
PYTHONDONTWRITEBYTECODE=1 python3 tools/build_search_data.py
```

통합지표 파일명에는 `_SSP시나리오_통합지표_연대별`이 포함되어야 합니다. 새 지역을 처음 추가할 때는 `tools/build_search_data.py`의 `SEARCH_REGIONS`와 `SHORT_NAMES`에도 지역명, 지도 좌표, 짧은 이름을 등록해야 합니다.

AI 모델을 다시 학습하려면 Python 패키지가 필요합니다.

```bash
python3 -m pip install numpy xgboost scikit-learn
python3 tools/train_model.py
python3 tools/eval_model.py
```

`train_model.py`는 `js/model.js`를 다시 만들고 Python 예측과 브라우저 계산이 일치하는지 검사합니다. `eval_model.py`는 모델을 바꾸지 않고 성능 지표를 다시 계산합니다. 모델 구조, 성능, 실험 근거는 [XGBOOST.md](XGBOOST.md)에 정리되어 있습니다.

## 수정 위치

| 바꾸려는 내용 | 수정할 파일 |
|---|---|
| 메뉴 이름과 페이지 순서 | `js/common.js`의 `PAGES` |
| 각 화면의 고정 문구와 구조 | 해당 `.html` |
| 홈 카드 생성 방식 | `js/page-home.js` |
| 게임 상황, 행동, 점수, 지역별 설명 | `js/game-data.js` |
| 게임 진행과 결과 표현 | `js/game.js` |
| CO₂·습도 실험과 그래프 | `js/mylab.js` |
| 지역 지도, 지표, 추이, 순위 | `js/app.js` |
| 개념 설명과 퀴즈 | `js/guide.js` |
| 색상, 간격, 반응형 배치 | `css/style.css` |

## 검사 방법

게임의 5라운드 전체 조합 1,024개와 예측 연결을 검사합니다.

```bash
node tools/check_game.js
```

JavaScript 문법을 한 번에 확인하려면 다음 명령을 사용할 수 있습니다.

```bash
for file in js/*.js; do node --check "$file"; done
```

최종 화면 확인 항목은 다음과 같습니다.

- 5개 HTML 화면이 모두 열리고 메뉴와 이전·다음 이동이 동작하는지
- 게임에서 선택한 지역만 지도 색이 바뀌는지
- 실험실의 CO₂·습도 조절과 그래프가 함께 갱신되는지
- 지역 보기에서 12개 지역 선택이 지도, 수치, 그래프, 순위에 동시에 반영되는지
- 퀴즈에서 정답·오답 피드백과 다음 문제가 정상 표시되는지
- 휴대폰 폭에서 가로 스크롤이나 글자 겹침이 없는지

## 주요 산출 방식

폭염위험지수는 지역과 연대를 비교하기 위한 프로젝트 내부 상대지표입니다.

```text
지수 = 가중 정규화 합계 / 사용한 가중치 합계 × 100

폭염일수       0~50일, 가중치 0.40
열대야일수     0~50일, 가중치 0.35
여름 체감온도  27~34℃, 가중치 0.25
```

결측 항목은 제외하고 남은 가중치를 다시 맞춥니다. 이 등급은 기상청 폭염 영향예보 등급과 같은 공식 경보 등급이 아닙니다.

AI는 SSP 4개 경로의 6개 지역 자료를 학습합니다. 입력은 지역, 지역의 2000년대 관측 기준값, 연대, CO₂ 농도이며 폭염일수·열대야일수·연평균기온·여름 체감온도를 각각 예측합니다. CO₂가 증가할 때 결과가 역으로 감소하지 않도록 단조 증가 제약을 적용했습니다.

## 알려진 제약

- AI 학습 지역은 6개로 제한되어 지역 조회용 추가 6개 지역에는 AI 예측을 제공하지 않습니다.
- 모델에는 도시화, 인구, 녹지, 해발고도 같은 별도 설명 변수가 없습니다.
- XGBoost 트리 특성상 슬라이더를 조금 움직여도 값이 그대로이다가 한 번에 변할 수 있습니다.
- 게임의 편함·배출 점수는 행동을 비교하기 위한 교육용 상대점수이며 실제 CO₂ 배출량 단위가 아닙니다.
- 10년 평균 자료에도 자연 변동이 남아 모든 지표가 연대마다 일정하게 증가하지는 않습니다.

## 라이선스 메모

- Pretendard: SIL Open Font License 1.1
- Plotly.js: MIT License
- 지도 배경: `sane-topojson`의 Asia 50m 자료
