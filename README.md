# Nürburgring Nordschleife — 1인칭 드라이빙 시뮬레이터

실제 OSM 도로 geometry + 실측 고도 데이터로 만든 노르트슐라이페 20.71km 풀코스.
Three.js + 자체 구현 차량 물리 (외부 물리엔진 없음).

## 실행

```
./run.sh            # 또는: python3 -m http.server 8741
open http://localhost:8741
```

ES 모듈 CORS 때문에 file:// 직접 열기는 안 됨. 로컬 서버 필수.
코드 수정 후에는 브라우저에서 **하드 리프레시 (Cmd+Shift+R)** — 모듈 캐시 주의.

## 조작

```
↑/W 가속   ↓/S 브레이크(정지 시 후진)   ←→/AD 조향   Space 핸드브레이크
M  자동/수동 변속      Shift/Ctrl  기어 업/다운 (수동 모드)
C  카메라 (콕핏/후드/체이스)    R  트랙 복귀 리셋 (랩 무효화)
T  TC+스태빌리티      B  ABS      P  일시정지      H  도움말
```

## 그래픽/게임플레이 (v2)

- 렌더링: ACES 톤매핑, PBR(Standard/Physical), Sky 셰이더 + PMREM 환경맵 반사
- 포스트: UnrealBloom + 속도 연동 radial blur + 비네트 (120fps 유지)
- 시간대: N키 — 정오 / 아침 안개(Eifel) / 석양
- 트랙: 러버 레코딩 라인, 카루셀 콘크리트 슬래브, 브레이킹 마커(100/50),
  km 포스트, BILSTEIN 다리, 광고판, 노면 그래피티(BTG 등)
- 월드: 실제 DEM 광역 지형(8×6.6km, 표고 292~723m), 침엽수+활엽수 2만 그루,
  Breidscheid 마을, Brünnchen 캠핑/깃발
- 고스트 랩: 베스트 랩 자동 저장/재생(G), 실시간 델타(±초) 표시
- 다이내믹 레이싱 라인(L): 곡률 한계속도+제동거리 역산 — 초록=풀스로틀/
  노랑=리프트/빨강=브레이크, 현재 속도에 실시간 반응
- 텔레메트리 위젯: 4륜 슬립 상태(락업=파랑/휠스핀=주황/한계=빨강),
  G-서클(마찰원), 페달/조향 입력 바
- 콕핏: 시프트 라이트 5LED(5300rpm~, 레드라인 점멸), TC/ABS 개입 경고등,
  ABS 작동 시 캐빈 진동
- 섹터 퍼플(올타임 베스트)/그린, 미니맵에 현재 랩 득실 트레일
- 차량: 프로파일 압출 해치백 바디 + 클리어코트 페인트, 터보 휘슬/블로우오프/팝콘 배기음

## 구조

```
data/track.json     트랙 데이터 (OSM 스티칭 + open-elevation 고도, 4142pt @ 5m)
js/track_data.js    위 데이터의 JS 모듈 버전
js/track.js         트랙 프레임(탄젠트/뱅킹/곡률), 공간 해시, 해석적 표면 쿼리
js/physics.js       강체 6DOF + 레이캐스트 서스펜션 + Pacejka 결합슬립 타이어
                    + 엔진 토크커브/기어박스/LSD + 공력 + 가드레일 충돌 (240Hz)
js/world.js         도로/연석/가드레일/지형/숲/표지판/하늘
js/car.js           콕핏(대시·휠·게이지·실시간 룸미러) + 외관
js/input.js         키보드 스무딩 (속도감응 조향)
js/audio.js         WebAudio 합성 (엔진/바람/스키드/잔디/스크레이프)
js/hud.js           랩타임(섹터/베스트 localStorage)/미니맵/섹션명
js/main.js          메인 루프, 카메라 리그
tools/build_track.py   트랙 데이터 재생성 (Overpass + open-elevation)
tools/test_*.py        Playwright 헤드리스 검증 (물리/핸들링/통합)
```

## 물리 노트

- 차량: 아반떼 N 스펙 — 1430kg FWD, 2.0T 280hp/392Nm(플랫토크), e-LSD,
  60:40 전륜하중, 0-100 6.0초(실측), 최고 ~250km/h, 살짝 언더스티어+플랜티드 리어
- 타이어: 정규화 Pacejka `sin(1.5·atan(1.73ρ))`, 마찰원 결합, 하중민감도
- 조향: 속도감응 락 `0.56/(1+(v/11)^1.5)` rad — 풀키 입력이 항상 그립 한계 근처
- 어시스트(키보드 친화): TC + ESP식 횡슬립 스로틀컷 + 카운터스티어(T로 끔), ABS(B)
- 뱅킹: 곡률 기반 합성, Karussell/Mini-Karussell은 ~16° 콘크리트 보울
- 실측 고도 347~622m (Flugplatz 점프, Fuchsröhre 압축 재현됨)
