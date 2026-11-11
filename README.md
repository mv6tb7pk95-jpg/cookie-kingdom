# Cookie Kingdom (가칭)

모바일 웹 기반 왕국 경영 + 수집 + 자동 전투 게임. 세계관, 캐릭터, 아트는 모두 오리지널로 제작한다.

## 구조
- `apps/client` Phaser 3 + Vite 클라이언트
- `apps/server` Cloudflare Workers + Hono API
- `packages/shared` 타입, 상수, 밸런스 수식
- `data` JSON 콘텐츠 (캐릭터, 건물, 스킬, 스테이지)
- `docs/ISSUES.md` 페이즈별 이슈 목록

## 시작
```bash
pnpm install
pnpm dev:server   # http://localhost:8787
pnpm dev:client   # http://localhost:5173 (/api 는 8787로 프록시)
```

## 배포 (GitHub Actions)
저장소 Secrets에 `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` 등록.
`main`에 병합하면 API(Workers)와 클라이언트(Pages)가 자동 배포된다.

## 브랜치
`main`(배포) / `dev` / `feat/기능명`. 커밋 접두사: `feat:` `fix:` `data:` `art:`
