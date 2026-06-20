# 게시본 (영어 — 그대로 복붙. 각 줄이 한 포스트/한 bullet)

— 1/4 —
a web-based driving game, built with fable 5

— 2/4 —
drive-game.pages.dev

— 3/4 —
kind of like slowroads.io, but i wanted something with more racing dna. it aims for the sim side, so it might be trickier than you'd expect — if you've raced on a keyboard before, you'll be fine.

— 4/4 —
- Custom vehicle physics, no game engine: 240 Hz fixed-step rigid body, raycast suspension, Pacejka combined-slip tires, clutch launch model, aero drag/downforce, per-surface and weather grip, TC/ABS
- Rendering: Three.js
- Track: real OpenStreetMap geometry — the 20.7 km Nordschleife, plus Spa and a practice circuit; SRTM elevation
- Cars: 5 (Elantra N, 992 GT3 / GT3 RS, kart, F1), each tuned to its real 0–100 and top speed
- Sound: synthesized, not sampled — an AudioWorklet waveguide engine tuned per car against spectrograms of real onboard recordings; engine, exhaust, shift, rev-limiter, tires, brakes, jolts and kerbs are separate toggleable layers
- Platform: one codebase → web (Vite) + Android (Capacitor)


# X (트위터) 버전 (영어 — 짧게, 포스트당 280자 이내. 빈 줄 = 포스트 내 줄바꿈)

— 1/3 —
a web-based nürburgring driving game, built almost entirely by fable 5.

no 3d assets — the car, track and environment are all generated in code.

drive-game.pages.dev

— 2/3 —
everyone's vibe-coding one-prompt games with it. i wanted to push it on the hard parts:

custom 240hz physics, no game engine. 5 cars tuned to their real 0-100 + top speed. engine sound synthesized per car from real onboard recordings.

— 3/3 —
the trick was giving it a measurable target + a way to verify, not just "make it realistic."

whole build session is public (korean, english toggle): drive-game.pages.dev/making


# 레딧 버전 (영어 — r/ClaudeAI. how/why + 프롬프트 팁 포함. 각 줄이 한 문단/한 bullet)

Title:
I made a web-based Nürburgring driving game with Fable 5 — and what actually worked when prompting it

Body:

A browser driving game on the Nürburgring — no install, runs in the browser (Android too): drive-game.pages.dev

Why: I wanted a quick drive with some actual racing DNA, something like slowroads.io but built around real circuits and real cars. It leans toward the sim side rather than arcade, so it might be trickier than you expect — if you've raced on a keyboard before, you'll be fine.

Most of the code was written by Claude Fable 5; I did the tuning and the feel. How I started: the first prompt wasn't a spec, it was the vision plus a few hard constraints — basically "a Nürburgring driving game, first-person, all the physics done properly, good on keyboard — plan it out properly first, ultrathink." I had it lay out a plan (track data, physics, rendering, cockpit, controls, HUD) and looked that over before any code got written. After that it was mostly short steers: "continue", or specific feedback like "steering feels reversed" or "the eye point is too low", and it would fix it and re-check with a headless test. Honestly the plan-first step mattered more than any single clever prompt.

The thing that made it more than a one-prompt toy, though, was giving Fable a measurable target and a way to check itself. A few patterns that worked:

- Physics: instead of "make it feel realistic", I gave it the real 0–100 and top speed for each car and told it to work backward from the actual equations (terminal velocity for top speed; traction-limited vs power-limited phases for 0–100), then verify against a headless Playwright test that drives the car and measures. Iterate until the numbers match. "Hit 0–100 of 3.2s and 296 km/h, derive it from the equations, measure with the test harness, repeat" beat "make the GT3 RS feel fast" every time.
- Sound: I pulled real onboard recordings, ran spectrograms, had it render the synth offline and compare the same spectrogram, then tune the engine params toward the real curve. An A/B loop against a measurement, not vibes — that's how the engine note stopped sounding like a generic muscle car.
- Keeping big changes safe: per-car tweaks are gated so an unset value changes nothing, which means retuning one car can't silently break the others. Worth telling the model to do this up front when you let it refactor broadly.

The takeaway: everyone's shipping one-prompt games with Fable right now, and they're fun, but if you hand it a real target plus a way to verify, it'll happily grind on the boring hard parts (physics, audio) far past what a single prompt gets you.

Tech, briefly: custom vehicle physics (no game engine) at 240 Hz — raycast suspension, Pacejka combined-slip tires, clutch launch, aero, per-surface/weather grip; 5 cars matched to real 0–100/top speed; synthesized engine sound (AudioWorklet) with toggleable layers; track is real OpenStreetMap geometry with SRTM elevation; Three.js, one codebase to web (Vite) + Android (Capacitor).

Repo: https://github.com/esc5221/drive-game (open source)

Give it a try and let me know how it drives — and happy to share more about the prompting/verification setup if anyone's curious.


# GeekNews 버전 (Show GN — 한국어. 담백·정중. 각 줄이 한 문단/한 bullet)

제목:
Show GN: Nürburgring Drive - Fable 5로 만든 웹 기반 드라이빙 게임

본문:

웹브라우저에서 바로 할 수 있는 뉘르부르크링 1인칭 드라이빙 게임을 만들었습니다. 설치 없이 바로 운전할 수 있습니다.
모바일에서는 가로 모드로 하면 전체화면으로 플레이 가능합니다

url: https://drive-game.pages.dev
GitHub: https://github.com/esc5221/drive-game

slowroads.io 같은 게임을 좋아하는데, 좀 더 실제 서킷이랑 진짜 차에 맞춘, 레이싱 dna가 있는 버전이 있으면 좋겠다 싶어서 만들었습니다. 아케이드보다는 심 쪽을 지향해서 생각보다 어려울 수 있는데, 키보드로 레이싱 게임 해보신 분들은 할만하실겁니다.

작동하는 버전의 코드는 Claude Fable 5가 다 짰고, 이후 기능 수정 / 튜닝이랑 감 잡는 부분만 손봤습니다. 한 줄 프롬프트로 게임 뚝딱 만드는 게 유행인데, 물리나 사운드처럼 손이 많이 가는 부분을 AI로 어디까지 파볼 수 있나 궁금해서 거기에 집중했습니다.

만들면서 통한 방식은 "그럴듯하게"가 아니라 측정 가능한 목표와 검증 방법을 같이 준 거였습니다.
- 물리: 차마다 실제 제로백·최고속도를 주고 방정식으로 역산하게 한 뒤, 헤드리스 테스트로 측정하면서 수치가 맞을 때까지 반복
- 사운드: 실제 온보드 녹음을 스펙트로그램으로 분석하고, 합성음을 오프라인 렌더해서 같은 방식으로 A/B 비교하며 파라미터를 맞춤

기술 요약:
- 차량 물리는 자체 구현(게임엔진 안 씀): 240Hz 고정 스텝 강체, 레이캐스트 서스펜션, Pacejka 복합 슬립 타이어, 클러치 런치 모델, 공력, 노면별·날씨별 접지력, TC/ABS
- 차량 5종(아반떼 N, 992 GT3 / GT3 RS, 카트, F1), 각각 실제 제로백·최고속도에 맞춰 튜닝
- 엔진음은 녹음 샘플이 아니라 합성(AudioWorklet) — 엔진·배기·변속·타이어·브레이크 등이 전부 따로 켜고 끄는 레이어
- 트랙은 실제 오픈스트리트맵(OSM) 지오메트리 — 20.7km 노르트슐라이페 + Spa + 연습 서킷, SRTM 고도
- 렌더링은 Three.js, 단일 코드베이스로 웹(Vite) + 안드로이드(Capacitor)

이 게임을 만든 전체 세션도 그대로 공개해뒀습니다. Fable과 처음부터 주고받은 대화를 볼 수 있고, 한국어 원문에 영어 토글이 붙어 있습니다. 중간에 보시면 fable 모델이 제한되어서.. 이후에는 opus로 사용하는것도 볼수있습니다
https://drive-game.pages.dev/making

이정도 퀄리티를 단시간에 AI모델들이 구현해주는걸 못봤었는데 , 확실히 Fable이 체감이 되게 좋았던거같습니다. 


# 글감 브리프 — drive-game 홍보 글 (Threads / Show HN)

플레이: https://drive-game.pages.dev
소스: https://github.com/esc5221/drive-game

직접 내 목소리로 쓰기 위한 재료. 아래 내용 중 골라서, 풀어서 쓴다.
완성 산문이 아니라 "무엇을 말할지 + 왜 그게 의미 있는지"의 모음.

═══════════════════════════════════════════
담을 내용 (위에서부터 우선순위. 다 넣을 필요는 없음)
═══════════════════════════════════════════

[1] 이게 뭔지 + 바로 해볼 수 있다는 점  ← 이건 무조건 들어감
    웹브라우저에서 바로 실행되는 뉘르부르크링 1인칭 드라이빙 게임이다.
    (뉘르부르크링 노르트슐라이페 = 독일의 20.7km짜리 전설적인 서킷, 차/레이싱
    좋아하는 사람들의 성지). 앱 설치도, 회원가입도 없이 링크 들어가면 바로
    운전이 시작된다. 안드로이드로도 돌아간다.
    → 왜 강조: 사람들은 "바로 해볼 수 있나"를 제일 본다. 진입장벽 0이 강점.

[2] 솔직한 포지션: 이건 아케이드지 하드코어 시뮬이 아니다
    iRacing이나 Assetto Corsa 같은 본격 시뮬레이터가 아니다. 키보드나 터치로
    즐기는, 접근성 좋은 아케이드 쪽이다. TC/ABS/자동변속 같은 어시스트가 있어서
    누구나 바로 탄다.
    → 왜 먼저 밝히나: "sim"이라고 하면 하드코어 유저들이 "이건 진짜 sim 아니다"
    라고 깐다. 먼저 "아케이드다"라고 인정하면 그 시비가 사라지고 정직해 보인다.

[3] 깊이 ① — 물리는 진짜로 계산한다
    조작은 가벼워도 차의 움직임은 제대로 시뮬레이션한다. 유니티/언리얼 같은
    기성 게임엔진이나 물리 라이브러리를 안 쓰고 직접 만든 물리 코드다. 초당
    240번 계산해서(240Hz) 서스펜션, 타이어 미끄러짐, 출발 가속, 공기저항·
    다운포스, 노면·날씨별 접지력까지 다룬다.
    구체 증거: 차 5종(아반떼 N, 포르쉐 992 GT3 / GT3 RS, 카트, F1)이 각각
    실제 제로백(0→100km/h)과 최고속도에 맞게 튜닝돼 있다.
    → 왜 중요: "AI로 대충 찍어낸 토이"가 아니라는 증거. 깊이.

[4] 깊이 ② — 엔진 소리도 녹음이 아니라 합성이다
    엔진음을 녹음 파일(샘플) 재생이 아니라 실시간으로 합성한다. 차마다 유튜브
    등 실제 온보드 영상의 엔진 소리를 스펙트로그램으로 분석해서, 그 주파수
    특성에 맞춰 합성음을 맞췄다. 엔진뿐 아니라 브레이크·타이어 스키드·변속·
    연석·레브리미터 소리가 전부 따로 켜고 끌 수 있는 레이어로 돼 있다.
    → 왜 중요: 차덕·오디오 디테일에 반응한다. 역시 깊이의 증거.

[5] 어떻게 만들었나 (정직하게)
    코드는 거의 다 Claude Fable 5(AI 모델)가 짰다. 나는 방향을 잡고, 감으로
    잡아야 하는 부분 — 주행 질감 튜닝, 차마다 엔진음 맞추기 — 을 손봤다.
    → 주의: 정직하게 밝히되 "Fable 대단하다"는 하입은 하지 않는다. 무게는
    "AI가 짰다"가 아니라 "내가 어디에 공을 들였나"에 둔다.

[6] 왜 만들었나 (동기 — 공감 포인트)
    평소 엔진 거동이 사실적인 레이싱 게임을 좋아하는데, 가끔 가볍게 빨리 한 판
    달리고 싶을 때 마땅한 게 없었다. slowroads.io(브라우저에서 끝없는 도로를
    달리는 chill한 운전 게임)를 좋아하는데, 그걸 좀 더 실제 서킷·실제 차에 맞춘
    버전이 있으면 좋겠다 싶어서 만들었다.
    → 왜 중요: 사람 냄새 나는 동기가 글의 진정성을 만든다.

[7] 차별 앵글 (바이럴 후크)
    요즘 Fable로 한 줄 프롬프트 넣어서 게임을 뚝딱 만드는 게 유행이다(스네이크
    같은 간단한 거). 나는 그런 토이 말고, 물리·사운드처럼 손 많이 가고 어려운
    부분을 AI로 어디까지 파볼 수 있나가 궁금해서 거기에 집중했다.
    → 왜 중요: "AI 슬롭" 비판을 피하면서 동시에 화제성을 만든다.

[8] 트랙 출처 (곁다리 — 넣어도 되고 빼도 됨)
    트랙을 대충 그린 게 아니라 실제 오픈스트리트맵(OSM) 지도 데이터에서
    노르트슐라이페 20.7km 전 구간을 뽑아 만들었고, 고도도 실제 지형 고도(SRTM)
    데이터를 썼다.

═══════════════════════════════════════════
기술 세부사항 (bullet — HN/소스/댓글에 그대로 붙이기 좋음)
═══════════════════════════════════════════

- Custom vehicle physics, no game engine: 240 Hz fixed-step rigid body, raycast
  suspension, Pacejka combined-slip tires, clutch launch model, aero drag/downforce,
  per-surface and weather grip, TC/ABS
- Rendering: Three.js
- Track: stitched from real OpenStreetMap raceway geometry — the 20.7 km
  Nordschleife, plus Spa and a practice circuit; SRTM elevation
- Cars: 5 (Elantra N, 992 GT3 / GT3 RS, kart, F1), each tuned to its real
  0–100 and top speed
- Sound: synthesized, not sampled — an AudioWorklet waveguide engine tuned per
  car against spectrograms of real onboard recordings; engine, exhaust, shift,
  rev-limiter, tires, brakes, jolts and kerbs are separate toggleable layers
- Platform: one codebase → web (Vite) + Android (Capacitor)
- Built mostly with Claude Fable 5; tuning and feel done by hand
- Open source: MIT (code), ODbL (track data)

── 한국어 ──

- 차량 물리는 자체 구현 (게임엔진 안 씀): 240Hz 고정 스텝 강체, 레이캐스트
  서스펜션, Pacejka 복합 슬립 타이어, 클러치 런치 모델, 공력(항력·다운포스),
  노면별·날씨별 접지력, TC/ABS
- 렌더링: Three.js
- 트랙: 실제 오픈스트리트맵(OSM) 지오메트리를 이어붙임 — 20.7km 노르트슐라이페
  + Spa + 연습 서킷, SRTM 고도 데이터
- 차량: 5종(아반떼 N, 992 GT3 / GT3 RS, 카트, F1), 각각 실제 제로백·최고속도에
  맞춰 튜닝
- 사운드: 녹음 샘플이 아니라 합성 — AudioWorklet 웨이브가이드 엔진을 차마다 실제
  온보드 녹음 스펙트로그램에 맞춰 튜닝. 엔진·배기·변속·레브리미터·타이어·
  브레이크·충격·연석이 전부 따로 켜고 끄는 레이어
- 플랫폼: 단일 코드베이스로 웹(Vite) + 안드로이드(Capacitor)
- 거의 Claude Fable 5로 제작, 튜닝·감 잡는 부분만 직접
- 오픈소스: 코드 MIT, 트랙 데이터 ODbL

═══════════════════════════════════════════
첫 문장(후크) — 하나만 고른다
═══════════════════════════════════════════

A 동기형   slowroads 좋아하는데 서킷·실차 버전이 없어서 만들었다  → 공감 잘 됨
B 결과형   브라우저에서 바로 하는 뉘르부르크링 게임 만들었다       → 깔끔·안전
C 대비형   다들 한 줄로 게임 뽑던데 나는 물리/사운드를 파봤다      → 약간 도발·바이럴
D 디테일형 엔진음을 차마다 실제 온보드 소리에 맞춰 합성했다        → 차덕 후킹

═══════════════════════════════════════════
구조
═══════════════════════════════════════════

Threads 2포스트:  1) 후크 + [1]뭔지 + 링크 + 깊이 하나([3] 또는 [4])
                  2) [5]제작방식 + [7]차별앵글 + 담백한 마무리
Show HN:          위 + [8]트랙 + 컨트롤 안내(H키) + 소스 링크

═══════════════════════════════════════════
쓸 때 하지 말 것
═══════════════════════════════════════════

- Fable 하입 (모델 칭찬 말고, 내가 공들인 부분으로 무게)
- "sim"으로 과대표방 (먼저 아케이드라고 인정 = 방어막)
- 마케팅·과장어("혁신적/완벽한/최고의"), 이모지 남발, 억지 밈톤
- 문장 중간 줄바꿈 (빈 줄은 포스트/생각 전환에만)
- 번역체·과한 격식 ("~할 수 있습니다"체 남발)
