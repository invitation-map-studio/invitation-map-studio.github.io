# 다산74 지리 자료와 공급원 검토

2026년 11월 20일 한국시간에 자료를 확인했다. 첫 주소인 경기도 남양주시 다산중앙로82번안길 74는 경기주택도시공사 목록의 **다산신도시 자연앤푸르지오** 단지다. 국공립어린이집 공시에서도 같은 주소를 단지 내로 표기한다. 주소와 단지명의 일치를 확인했으며 방문할 동, 보행자 출입구, 차량 진입구는 추가 근거가 필요하다. [경기주택도시공사 주택목록](https://apply.gh.or.kr/co/cop/selectAstMngListPopup.do) · [어린이집 정보공시](https://info.childcare.go.kr/info/pnis/search/preview/SummaryInfoSlPu.jsp?STCODE_POP=41360000049&flag=YJ)

## 표식과 지도 범위

| 항목 | 확인 내용 |
| --- | --- |
| OSM 단지 경계 | way/825237097 v5에 같은 단지명이 있다. 마지막 객체 변경일은 2025-11-02 UTC다. [OSM 경계](https://www.openstreetmap.org/way/825237097) |
| 표식 | 닫힌 단지 경계의 면적중심인 북위 37.6149503°, 동경 127.1644568°. 단지 대표 위치를 가리킨다. 특정 동과 출입구 위치는 미확인이다. |
| 조회 경계 | WGS84 남 37.6115°, 서 127.159°, 북 37.6187°, 동 127.168°. 이 경계 안에 미리보기 전체가 들어가는 세로 기준 반경은 220 m다. |
| 도로·시설 | 저장한 147개 highway way 중 차도 유형 118개를 약도 후보에 사용한다. 이들 원천 도로는 정점 653개(중복 포함), 2개 이상 way가 공유하는 노드 ID 143개다. 시설과 버스정류장 후보는 총 16개다. |
| 변환 전 점검 | 동일 도로의 노드 수와 점 수, 노드 참조 순서, 원본 경·위도와 앱의 점 배열을 대조했다. 다산중앙로82번안길은 6개 way로 나뉜다. 그중 way/575116416은 터널이고, 북부간선로의 일부는 교량이다. 레이어와 연결 노드를 보존했다. |
| 독립 자료 | 다산별빛초등학교는 같은 도로 40번, 금교초등학교는 미금로 194번을 기관에서 안내한다. OSM 학교 부지 중심은 단지 중심을 기준으로 각각 북동쪽 약 247 m, 남서쪽 약 273 m다. 방향과 거리는 OSM에서 계산했다. [다산별빛초](https://dasanbyeolbit-e.goegn.kr/dasanbyeolbit-e/lm/location/locationMapView.do?mi=9449) · [금교초](https://kumkyo-e.goegn.kr/kumkyo-e/lm/location/locationMapView.do?mi=10613) |
| 위치 검수 | 입구 태그를 이 범위에서 찾지 못했다. 도로의 현장 접근성, 단지 출입구, 길 안내 완결성은 확인 필요다. 11월 20일 주소 대조일과 원본 취득시각은 독립 필드로 보존한다. |

## 실제 취득 기록

1. 공개 Overpass의 소규모 도로 요청은 35초 동안 일부 바이트만 받고 시간 초과됐다. 같은 요청의 압축 재시도는 HTTP 502였다. Private.coffee의 범위 조회도 60초간 응답 없이 종료됐다. 부분 파일은 버리고 성공 조회로 기록하지 않았다.
2. 검증 자료 1건 확보를 위해 OSM 본서버의 명시한 한 개의 bbox 자료를 수동 요청했다. 2026-11-20 09:33:18 KST에 완전한 JSON 3,408요소를 받았다. 개발용 CLI에서 실행했다. 공개 Pages의 CORS 성공 기록은 별도로 필요하다. OSM 편집 API는 상시 읽기 서비스의 백엔드로 쓰기에 부적합하므로 앱과 반복 평가에서 이 경로를 사용하지 않는다. [OSM API 사용 정책](https://operations.osmfoundation.org/policies/api/)
3. 원 응답 SHA-256은 `402871af5e50e6c62c825087e5db1adbb1642220ba8b20b2c1fe21b5d0396b1d`다. 변환본에는 객체 ID, 버전, 시각, 표시에 필요한 태그, 노드 참조와 좌표를 남겼다. 사용자명·사용자 ID와 변경집합은 제외했다.

저장본은 [다산74 JSON](../data/dasan74.json)에 있다. `source`는 원천과 권한, `evidence`는 주소 대조와 검수 상태, `elements`는 OSM 객체, `geo`는 브라우저 입력이다. `geo`의 점은 [경도, 위도] 순서다. 이 OSM 파생 데이터의 라이선스는 ODbL 1.0이다. 각 출력의 지도 본문에도 “© OpenStreetMap contributors”와 저작권 페이지 주소가 들어가야 한다. [OSM 저작권](https://www.openstreetmap.org/copyright) · [ODbL 전문](https://opendatacommons.org/licenses/odbl/1-0/)

같은 파일을 재생성할 때는 원 응답과 실제 수신시각을 사용한다. 새 원본으로 갱신할 때에는 별도 파일을 만들고 원본 변경과 입구 확인 상태를 비교한다.

```sh
python3 data/prepare_dasan74.py original.json dasan74.updated.json --fetched-at 2026-11-20T00:33:18Z
```

## 공급원별 사용 범위

| 공급원 | 가능 범위와 조건 | 현 상태 |
| --- | --- | --- |
| OSM 데이터 | ODbL, 출처 표기, 파생 데이터 공개 시 같은 라이선스 적용. 단독 PNG·PDF·SVG와 지도만 출력에도 크레딧과 저작권 주소 표시. [라이선스](https://www.openstreetmap.org/copyright) · [출처 표기 지침](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines) | 다산74 원본 취득. 재배포 권한이 확인된 OSM 지리를 로컬 저장 대상으로 삼는다. |
| Overpass | 도로와 시설을 좁은 범위에서 사용자 요청 시 읽는다. 공용 인스턴스는 공유 자원이며 큰 부하, 동일 요청 반복 및 상시 백엔드 의존을 피한다. Private.coffee는 최적화된 소량 쿼리, 개인정보 제외 등 해당 운영자 조건이 적용된다. [공용 이용 지침](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html) · [Private.coffee 운영 조건](https://overpass.private.coffee/index.html) | CLI 연결 실패 기록은 위와 같다. 다지역 평가에는 공개 추출본 파일을 사용한다. |
| Juso 주소 좌표 검색·팝업 | 행정안전부 공개 설명에서 무료, 이용허락범위 제한 없음, 1시스템 1승인키로 안내한다. 검색형은 행정코드, 도로명코드, 지하여부, 본번·부번이 필요하며, 팝업형은 결과 반환 URL을 받는다. 투영 X·Y를 WGS84로 검증 변환해야 한다. [검색형](https://www.data.go.kr/data/15056663/openapi.do) · [팝업형](https://www.data.go.kr/data/15057559/openapi.do) | 승인키와 등록된 출처, 반환 시 POST 수신 및 CORS, 좌표계와 이용조건 실측은 보류. 이번 다산74 원본에는 Juso API 응답을 포함하지 않았다. |
| 네이버 지도 | Geocoder 화면 대조는 등록 웹 주소와 브라우저용 ID가 필요하다. 출력·파생·보관 권한은 별도 확인 대상이다. 해당 확인 전에는 반환 좌표, 타일, 화면 캡처를 원천이나 24시간 캐시에 넣지 않는다. [JS Geocoder](https://navermaps.github.io/maps.js.ncp/docs/tutorial-Geocoder-Geocoding.html) · [Maps 약관](https://www.ncloud.com/policy/terms/maps) | 브라우저 조회·계정 한도 차단 시험은 등록된 Pages 출처 및 시험 Application 준비 후에 수행한다. 대표 계정, API별 일·월 한도, 초과 사용 불허, 중지·재개 기록은 운영자가 확인한다. [콘솔 가이드](https://guide.ncloud-docs.com/docs/application-maps-app-vpc) |
| 다산순환로 20 제공 파일 | 완성 디자인 및 출력 규격의 회귀 비교용 샘플. 첨부 Readme의 기존 대조 방법과 날짜를 보존한다. | 다산74의 근거로 승격하거나 샘플에서 좌표를 역추정하지 않는다. |
