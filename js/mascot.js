// mascot.js - 디딤이 등장 엔진
//
// 다른 모듈은 이 파일의 함수들만 부르면 된다:
//   Mascot.say('트리거이름')        - 해당 대사를 말풍선으로 보여준다 (js/mascot-lines.js에서 찾음, 하루 1회)
//   Mascot.showAmbient('표정')      - 말풍선 없이 그 표정 그대로 "계속" 떠 있게 한다 (홈/노출 대기/
//                                     휴식 대기 화면처럼 화면에 머무는 동안 계속 보여야 하는 경우)
//   Mascot.clearAmbient()           - ambient 상태를 끄고 숨긴다 (그 화면을 벗어날 때)
//   Mascot.flashFace('표정', 'anim', ms) - 말풍선 없이 표정만 ms 동안 잠깐 보여주고 원래 상태로
//                                     되돌아간다. 하루 1회 제한이 없어서 "기록 저장 완료"처럼
//                                     매번 보여줘야 하는 즉각 반응에 쓴다.
//   Mascot.hide()                   - 디딤이를 화면에서 완전히 숨긴다 (ambient도 함께 꺼짐)
// 노출/녹음재생/호흡 진행 중, 그라운딩 중에는 각 모듈이 Mascot.lock()/unlock()을 불러서
// 실수로 등장하는 것을 막는다 (주의분산 방지 - "디딤돌 마스코트 등장 스크립트"의 "원칙").
//
// 규칙 (스크립트 원문 + 2026-11-25 화면별 마스코트 상태 요청):
// - 같은 대사는 하루에 한 번만 보여준다 (localStorage: mascotSeen)
// - 말풍선은 탭하면 사라진다 (단, ambient 중이면 표정은 남고 말풍선만 사라짐)
// - 설정에서 끌 수 있고, 꺼도 앱 기능은 그대로 동작한다 (mascot-enabled)
// - 조작 없이 일정 시간이 지나면(IDLE_SLEEP_MS) 잠자는 표정으로 바뀐다. 단 노출/녹음재생/
//   호흡 진행 중·그라운딩 중(lock 상태)에는 원래부터 숨어 있으므로 건드리지 않는다.

(function () {
  const SEEN_KEY = 'mascotSeen'; // { [트리거]: 'YYYY-MM-DD' }
  const ENABLED_KEY = 'mascot-enabled';
  const GREETING_INDEX_KEY = 'mascotGreetingIndex';
  const LAST_VISIT_KEY = 'mascotLastVisit';
  const IDLE_SLEEP_MS = 3 * 60 * 1000; // 3분간 조작이 없으면 잠자는 표정

  // face 코드 -> 그림 파일. default/rest/quiet는 전달받은 그림이 하나(기본/편안한 표정)뿐이라
  // 같은 파일을 공유하고, curious/eyeSmile도 같은 "눈웃음" 그림을 공유한다.
  const FACE_IMAGES = {
    default: 'assets/mascot-default.png',
    rest: 'assets/mascot-default.png',
    quiet: 'assets/mascot-default.png',
    curious: 'assets/mascot-eyesmile.png',
    eyeSmile: 'assets/mascot-eyesmile.png',
    joy: 'assets/mascot-joy.png',
    sleep: 'assets/mascot-sleep.png',
  };
  const DEFAULT_FACE = 'default';

  const widgetEl = document.getElementById('mascot-widget');
  const bubbleEl = document.getElementById('mascot-bubble');
  const imgEl = document.getElementById('mascot-widget-img');

  if (!widgetEl || !bubbleEl || !imgEl || !window.MASCOT_LINES) return;

  // 여러 모듈이 동시에 잠글 수 있어서(예: 녹음 재생 중에 그라운딩까지 겹치는 경우) boolean이
  // 아니라 카운터로 관리한다. 안쪽에서 풀려도 바깥쪽이 아직 잠겨 있으면 계속 숨어 있어야 한다.
  let lockCount = 0;
  let hideTimeoutId = null;
  let idleTimerId = null;
  let ambientFace = null; // 현재 화면에 "계속" 띄워둘 표정. null이면 ambient 비활성
  let sleeping = false; // 장시간 미조작으로 잠자는 표정으로 바뀐 상태인지

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function isEnabled() {
    return PEStorage.load(ENABLED_KEY, true);
  }

  function alreadyShownToday(trigger) {
    const seen = PEStorage.load(SEEN_KEY, {});
    return seen[trigger] === todayStr();
  }

  function markShownToday(trigger) {
    const seen = PEStorage.load(SEEN_KEY, {});
    seen[trigger] = todayStr();
    PEStorage.save(SEEN_KEY, seen);
  }

  function setFace(face) {
    imgEl.src = FACE_IMAGES[face] || FACE_IMAGES[DEFAULT_FACE];
  }

  function setBreathing(on) {
    imgEl.classList.toggle('mascot-anim-breathe', on);
  }

  // 흔들기/점프처럼 한 번만 재생하는 애니메이션은 클래스를 뗐다가 강제로 리플로우한 뒤 다시
  // 붙여야 같은 트리거가 연달아 와도 처음부터 재생된다 (클래스만 다시 추가하면 브라우저가
  // "이미 붙어있던 클래스"로 보고 애니메이션을 재시작하지 않음).
  function playOnceAnim(animName) {
    const className = 'mascot-anim-' + animName;
    imgEl.classList.remove('mascot-anim-wiggle', 'mascot-anim-jump');
    void imgEl.offsetWidth;
    imgEl.classList.add(className);
  }

  function clearHideTimeout() {
    if (hideTimeoutId) {
      clearTimeout(hideTimeoutId);
      hideTimeoutId = null;
    }
  }

  function hide() {
    clearHideTimeout();
    widgetEl.hidden = true;
    bubbleEl.hidden = true;
    bubbleEl.textContent = '';
    setBreathing(false);
  }

  // 잠깐 보여준 표정/말풍선을 거둘 때 호출한다. ambient로 지정해둔 화면(홈/노출 대기/휴식
  // 대기)에 있는 중이면 그 표정으로 돌아가고, 아니면 완전히 숨긴다.
  function settle() {
    clearHideTimeout();
    if (sleeping) return; // 잠자는 중엔 다른 전환이 깨우지 않는다 - 실제 조작이 있어야 깸
    if (ambientFace && lockCount === 0 && isEnabled()) {
      widgetEl.hidden = false;
      bubbleEl.hidden = true;
      bubbleEl.textContent = '';
      setFace(ambientFace);
      setBreathing(true);
    } else {
      hide();
    }
  }

  function say(trigger) {
    if (lockCount > 0 || !isEnabled()) return;

    const line = window.MASCOT_LINES[trigger];
    if (!line) return;
    if (alreadyShownToday(trigger)) return;

    markShownToday(trigger);
    clearHideTimeout();

    widgetEl.hidden = false;
    if (line.face) setFace(line.face);
    if (line.anim) playOnceAnim(line.anim);

    if (line.text) {
      bubbleEl.hidden = false;
      bubbleEl.textContent = line.text;
    } else {
      bubbleEl.hidden = true;
      bubbleEl.textContent = '';
    }

    // 말풍선이 있는 동안은 숨쉬기(ambient 전용 애니메이션)를 끄고, autoHideMs가 지나면
    // settle()이 ambient 여부를 다시 판단한다.
    setBreathing(false);
    if (line.autoHideMs) {
      hideTimeoutId = setTimeout(settle, line.autoHideMs);
    }
  }

  // 홈/노출 대기/휴식 대기 화면처럼 "그 화면에 머무는 동안 계속" 보여줄 표정을 지정한다.
  // 말풍선 없이 숨쉬기 애니메이션만 돈다. 같은 화면에 있는 동안 여러 번 불러도 안전하다.
  function showAmbient(face) {
    ambientFace = face;
    if (lockCount > 0 || !isEnabled() || sleeping) return;
    widgetEl.hidden = false;
    bubbleEl.hidden = true;
    bubbleEl.textContent = '';
    setFace(face);
    setBreathing(true);
  }

  // ambient 화면을 벗어날 때 부른다. 다른 말풍선이 떠 있지 않다면 완전히 숨긴다.
  function clearAmbient() {
    ambientFace = null;
    if (!sleeping) hide();
  }

  // 말풍선 없이 표정만 ms 동안 보여주고 원래 상태(ambient가 있으면 그 표정, 없으면 숨김)로
  // 되돌아간다. say()와 달리 하루 1회 제한이 없어서 "기록 저장 완료"처럼 매번 반응해야 하는
  // 순간에 쓴다.
  function flashFace(face, animName, ms) {
    if (lockCount > 0 || !isEnabled()) return;
    clearHideTimeout();
    widgetEl.hidden = false;
    bubbleEl.hidden = true;
    bubbleEl.textContent = '';
    setFace(face);
    setBreathing(false);
    if (animName) playOnceAnim(animName);
    hideTimeoutId = setTimeout(settle, ms || 1600);
  }

  // 일반 접속 시 우선순위대로 하나만 고름: 오래간만 > 늦은 밤 > 기본 인사(돌아가며)
  function sayContextualGreeting() {
    const last = PEStorage.load(LAST_VISIT_KEY, null);
    PEStorage.save(LAST_VISIT_KEY, new Date().toISOString());

    if (last) {
      const diffDays = (Date.now() - new Date(last).getTime()) / (24 * 60 * 60 * 1000);
      if (diffDays >= 7) {
        say('return.afterLong');
        return;
      }
    }

    const hour = new Date().getHours();
    if (hour >= 0 && hour < 5) {
      say('time.lateNight');
      return;
    }

    sayGreetingDefault();
  }

  function sayGreetingDefault() {
    if (lockCount > 0 || !isEnabled()) return;
    if (alreadyShownToday('greeting.default')) return;

    const greetings = window.MASCOT_GREETINGS || [];
    if (greetings.length === 0) return;

    const index = PEStorage.load(GREETING_INDEX_KEY, 0) % greetings.length;
    PEStorage.save(GREETING_INDEX_KEY, (index + 1) % greetings.length);

    markShownToday('greeting.default');
    widgetEl.hidden = false;
    setFace(DEFAULT_FACE);
    bubbleEl.hidden = false;
    bubbleEl.textContent = greetings[index];
  }

  function lock() {
    lockCount++;
    hide();
  }

  function unlock() {
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) settle();
  }

  // ----- 장시간 미조작: 잠자는 표정 -----
  // 노출/녹음재생/호흡 진행 중·그라운딩 중(lock 상태)에는 원래부터 숨어 있으니 건드리지 않고,
  // ambient가 꺼져 있는(아무 화면 상태도 아닌) 경우에도 재우지 않는다 - 갑자기 없던 마스코트가
  // 자다가 나타나면 더 혼란스러울 수 있어서, 이미 떠 있던 화면에서만 잠든다.
  function resetIdleTimer() {
    if (idleTimerId) clearTimeout(idleTimerId);
    if (sleeping) {
      sleeping = false;
      settle();
    }
    idleTimerId = setTimeout(() => {
      if (lockCount > 0 || !isEnabled() || !ambientFace) return;
      sleeping = true;
      clearHideTimeout();
      widgetEl.hidden = false;
      bubbleEl.hidden = true;
      bubbleEl.textContent = '';
      setFace('sleep');
      setBreathing(false);
    }, IDLE_SLEEP_MS);
  }

  ['pointerdown', 'keydown', 'touchstart'].forEach((eventName) => {
    window.addEventListener(eventName, resetIdleTimer, { passive: true });
  });
  resetIdleTimer();

  // 말풍선을 탭하면 말풍선만 조용히 사라진다 (ambient 중이면 표정은 그대로 남음)
  bubbleEl.addEventListener('click', settle);

  window.Mascot = { say, hide, lock, unlock, showAmbient, clearAmbient, flashFace };

  // 앱을 처음 열었을 때 한 번: 시작화면/환자코드 화면이 닫힌 뒤 홈에서 보여주기 적당하므로
  // safety.js의 흐름이 끝난 다음 턴에 실행되도록 아주 약간 늦춘다
  setTimeout(sayContextualGreeting, 50);
})();
