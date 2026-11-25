// micro-reactions.js - 아주 작은 피드백 효과 두 가지
//
// - ripple(): 기록을 저장하면 물결이 한 번 번진다
// - firefly(): 과제를 완전히 마치면(중도 종료 제외) 반딧불 하나가 떠오른다
//
// 둘 다 SUDS 값과는 무관한, 순수한 "저장됐어요/잘 마쳤어요" 피드백이다.
// SUDS를 수위가 차오르는 식으로 표현하면 압도감을 줄 수 있어 물 은유는 배경/잔잔한 물결로만
// 쓰기로 했으므로, 이 효과들도 SUDS 값에 반응하거나 크기가 변하지 않는다.

(function () {
  function spawn(el, durationMs) {
    document.body.appendChild(el);
    setTimeout(() => el.remove(), durationMs);
  }

  function ripple() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const el = document.createElement('div');
    el.className = 'micro-ripple';
    el.setAttribute('aria-hidden', 'true');
    spawn(el, 900);
  }

  function firefly() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const el = document.createElement('div');
    el.className = 'micro-firefly';
    el.style.left = `${40 + Math.random() * 20}%`;
    el.setAttribute('aria-hidden', 'true');
    spawn(el, 1800);
  }

  window.MicroReaction = { ripple, firefly };
})();
