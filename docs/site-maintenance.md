# KICKS 웹사이트 수정 안내

파일을 수정한 뒤 `npm run build`로 확인하고 작업 브랜치에 커밋·푸시합니다. PR을 만들고 **Squash and merge**한 뒤 배포가 완료되면 사이트에 반영됩니다.

## 선수 모집을 마감하고 대기명단 받기

**파일:** `src/data/recruitment.json`

- 모집 중: `"player_status": "open"`
- 모집 마감·대기명단 접수: `"player_status": "waitlist"`
- 다음 모집 시즌: `season` 변경 (예: `"SP27"`)
- 선수 지원 폼: `player_form_url` 변경. 현재 지원과 대기명단은 같은 폼을 사용합니다.

상태에 따라 선수 카드·버튼·안내가 함께 바뀝니다. 매니저는 계속 상시 모집입니다. 상태는 자동으로 마감되지 않으며, 파일 수정과 배포가 필요합니다.

가입 안내의 활동 시간·회비·매니저 폼은 `src/pages/join.astro`에서 수정합니다. 한국어와 영어를 함께 확인해주세요.

## 사진 앨범 추가하기

1. `src/assets/gallery/<앨범-id>/` 폴더에 사진을 넣습니다. 예: `sp27-gm1/`.
2. `src/data/gallery-albums.json` 배열에 아래와 같은 항목을 추가합니다.

```json
{
  "id": "sp27-gm1",
  "title": "General Meeting #1",
  "title_ko": "GM 1 · 전체 모임",
  "date": "2027-01-20",
  "cover": "1.jpg"
}
```

날짜와 파일명은 실제 값으로 바꿔주세요. `cover`는 해당 폴더 안에 있는 파일명이며 생략하면 첫 사진을 사용합니다.

사진은 파일명 숫자순으로 정렬됩니다. 앨범은 날짜가 최신인 순서로 표시되고 홈에는 최신 3개가 나옵니다. 빈 앨범은 표시되지 않습니다. 사진·데이터를 추가한 뒤 빌드·배포해야 반영됩니다.

## 일정 추가·변경하기

**파일:** `src/data/schedule.json`

- `date`: `YYYY-MM-DD`. 날짜 자체가 미정이면 `null`.
- `title` / `title_ko`: 영어 / 한국어 행사명.
- `location`: 활동 장소.
- `time` / `time_ko`: 영어 / 한국어 시간 안내. 기존 항목의 형식을 따라 작성합니다.
- `type`: `league`, `event`, `friendly`, `ceremony` 중 하나.
- 리그 경기일은 `league`와 `week`도 지정합니다. 이 날짜는 데이터 파이프라인에서도 사용합니다.
- 날짜가 잠정 확정이면 `tbd: true`를 추가합니다. 확정되면 제거하거나 `false`로 바꿉니다.

실제 날짜가 확정되지 않았다면 추측해서 넣지 마세요. 기존 일정을 변경할 때 리그 ID와 주차는 그대로 유지하고 해당 항목의 날짜·장소 등을 수정합니다.

## 경기 기록과 업데이트 날짜

골·도움·출석·경기 결과는 **Google Sheet에서 수정**합니다. `matches.json`, `league_table.json`, `player_profiles.json` 등 생성 데이터는 직접 수정하지 않습니다.

자동 갱신을 기다리거나 GitHub의 **Actions → Update League Data → Run workflow**로 갱신할 수 있습니다. 로컬에서는 검증 후 `python scripts/update_data.py`를 실행합니다.

`src/data/data-updates.json`도 자동 생성 파일입니다. 기록이 바뀔 때만 리그별 업데이트 시간이 바뀌며 사이트에는 미국 중부시간으로 표시됩니다. 첫 추적 갱신 전에는 최근 경기일을 표시합니다.

## 없는 페이지 안내

- 없는 페이지 안내 문구·이동 링크: `src/pages/404.astro`.

## 확인 순서

1. `npm run build`가 성공하는지 확인합니다.
2. 수정한 화면에서 **한국어·영어**를 모두 확인합니다.
3. 모바일 너비에서 문구와 버튼이 넘치지 않는지 확인합니다.
4. PR 병합 후 배포가 완료되면 실제 사이트에서도 확인합니다.
