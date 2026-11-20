# 네이버 실시간 확인과 Juso 좌표 연동 조건

2026년 11월 20일 기준이다. 기본 약도에는 저장·가공 권한이 확인된 데이터만 넣는다. 네이버 확인 버튼은 화면 대조용이며 결과를 프로젝트, 로그, 파일 또는 이 앱의 캐시에 기록하지 않는다. [네이버 클라우드 Maps 이용약관](https://www.ncloud.com/policy/terms/maps)

## 네이버 확인 화면

1. 시험용 Application에서 Web Dynamic Map과 Geocoding을 선택한다. 등록 웹 서비스 URL에는 실제 Pages 호스트를 입력한다. 콘솔에서 설정 형식과 허용 도메인을 확인한다. [Application 설정](https://guide.ncloud-docs.com/docs/maps-app) · [인증 문제 해결](https://guide.ncloud-docs.com/docs/maps-troubleshoot)
2. 공급자에서 API별 일·월 한도와 초과 사용 불허를 설정한 뒤 시험용 브라우저 Client ID를 사용한다. JS SDK에는 ncpKeyId와 geocoder 서브모듈을 전달한다. 서버용 Client Secret은 사용하지 않는다. [JS SDK Client ID](https://navermaps.github.io/maps.js.ncp/docs/tutorial-1-Getting-Client-ID.html) · [Geocoder 사전 준비](https://navermaps.github.io/maps.js.ncp/docs/module-geocoder.html)
3. 화면 잠금 해제 후 실시간 확인을 열면 주소를 네이버로 보낸다. 결과의 x는 경도, y는 위도다. 후보가 여러 개면 사용자가 하나를 선택한다. 표식은 주소 대표점에 놓으며 도보·주차장 입구 검수와는 별개다. [주소 검색 응답](https://navermaps.github.io/maps.js.ncp/docs/tutorial-Geocoder-Geocoding.html)
4. 닫기는 지도와 주소 후보를 지운다. SDK 전송이 시작된 요청은 공급자 사용량에 잡힐 수 있다. 늦게 도착한 결과는 닫힌 화면에 그리지 않는다. 인증 오류, 검색 실패와 지연에 대한 자동 재시도는 없다. 인증 실패 후 재설정한 키를 적용하려면 새로고침한다. [지도 제거 메서드](https://navermaps.github.io/maps.js.ncp/docs/naver.maps.Map.html)

### CSP와 실제 점검 범위

공개 SDK와 geocoder 스크립트를 읽어 확인한 시작 호스트는 다음과 같다. 네이버의 지도 스타일 메타데이터, 타일 CDN은 릴리스와 설정에 따라 달라질 수 있다. 실제 등록 Pages에서 브라우저 네트워크 기록으로 허용 목록을 검증한다. [공식 SDK](https://oapi.map.naver.com/openapi/v3/maps.js) · [공식 Geocoder 모듈](https://oapi.map.naver.com/openapi/v3/maps-geocoder.js)

| 용도 | HTTPS 호스트 |
| --- | --- |
| 스크립트와 모듈, SDK 인증 | oapi.map.naver.com |
| Geocoding 네트워크 요청 | maps.apigw.ntruss.com |
| 지도 스타일 메타데이터·이미지 | map.pstatic.net, nrbe.pstatic.net |
| SDK 이미지·타일 | ssl.pstatic.net, simg.pstatic.net |

인증·SDK·geocoder 요청 각각에서 성공과 오류 상태, 빈 결과, 다중 후보, 승인되지 않은 도메인, 낮은 시험 한도에서 추가 요청 거절을 확인한다. 서버 비밀번호나 사용자별 API 인증은 기본 모드의 범위 밖이다. 요청 URL 원문에는 식별자와 조회 주소가 들어갈 수 있으므로 증거에는 시각, 호스트, 경로명, 상태 코드와 익명화된 건수만 남긴다. 이 문서 작성 시 운영 키, 콘솔 설정, 실제 배포 출처에서의 네이버 호출·차단은 검증되지 않았다.

## Juso

행정안전부의 주소별 좌표 검색 API는 시스템별 승인키를 사용한다. 일반 주소 검색에서 후보를 선택한 뒤 행정구역코드, 도로명코드, 지하여부, 건물 본번·부번으로 좌표를 요청한다. 좌표 검색은 임의의 자유 입력 주소만으로 호출할 수 없다. 공공데이터포털의 검색 API 항목에는 이용허락범위 제한 없음, 무료로 표시되며, 트래픽은 제공기관 기준을 따른다. [행정안전부 좌표 검색 API 등록 정보](https://www.data.go.kr/data/15056663/openapi.do)

공식 연동 가이드는 HTTPS addrCoordApi.do의 XML·JSON 응답과 addrCoordApiJsonp.do의 JSONP 응답을 별도 경로로 제시한다. JSONP는 외부 호스트의 스크립트를 실행하므로 배포 도메인과 승인키의 공개 사용 조건 및 실제 응답을 확인한 후 선택한다. 일반 JSON 경로가 임의의 Pages 출처에서 fetch 가능한지는 실제 브라우저의 CORS 응답 검사가 필요하다. [좌표제공 검색 API 연동 가이드](https://business.juso.go.kr/jst/jstCoordApiSearch)

팝업 경로는 addrCoordUrl.do에 전용 승인키와 결과를 받을 returnUrl을 전달하는 방식이다. 정적 Pages가 해당 반환 방식과 HTTP 메서드를 받을 수 있는지 별도로 검증해야 한다. 좌표 자료의 GRS80 UTM-K와 출력 지리 모델 WGS84 사이에는 명시적인 변환과 알려진 지점 대조가 필요하다. 대문·차량 진입로를 표시하려면 독립 근거를 추가한다. [좌표제공 팝업 가이드](https://business.juso.go.kr/jst/jstCoordApiPop) · [행정안전부 좌표 팝업 API](https://www.data.go.kr/data/15057559/openapi.do) · [좌표계 설명](https://egovframe.go.kr/docs/archive/egovframework/%EA%B3%B5%ED%86%B5%EC%BB%B4%ED%8F%AC%EB%84%8C%ED%8A%B8/com/v4.3/sym/%EB%8F%84%EB%A1%9C%EB%AA%85%EC%A3%BC%EC%86%8C%EC%97%B0%EA%B3%84.html)

현재 빌드에는 Juso 승인키, 검색 JSONP, 팝업 콜백 또는 서버 중계기를 포함하지 않는다. 키 승인과 출처 실험 후 흐름을 채택한다.
