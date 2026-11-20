# 약도 글꼴과 윤곽선 검증

다산순환로 20 기준 SVG에 사용된 Noto Serif CJK KR 보통·굵게와 Noto Sans CJK KR 보통의 글리프 너비와 외곽선을 고정했다. 원본 글꼴의 저작권과 SHA-256은 public/fonts/NOTICE.txt, 배포 라이선스 전문은 public/fonts/OFL.txt에 있다. [Noto CJK 공식 배포판](https://github.com/notofonts/noto-cjk/releases)

## 지원 범위

세 글꼴 모두 현대 한글 음절 11,172자를 제공한다. NFC 정규화 후 초성·중성·종성으로 분해된 현대 한글도 같은 음절로 출력한다. 영문·숫자, KS X 1001 한자, 호환 자모, 통화·주소·문장부호 등은 원본이 제공하는 글자를 포함했다. 글꼴마다 17,030개 코드 포인트를 저장한다. 미지원 글자는 문자와 유니코드 번호를 보여 주고 출력을 중단한다.

브라우저는 문구에 필요한 글꼴과 유니코드 범위만 같은 출처에서 읽는다. 408개 청크의 전체 크기는 20,686,262바이트이고 가장 큰 청크는 163,001바이트다. 압축 해제된 청크는 최근 12개를 메모리에 유지한다. 편집용 SVG의 텍스트를 외부 편집기에서 원래 모양으로 보려면 해당 Noto 글꼴을 설치한다. 윤곽선 SVG·PNG·PDF에는 별도 폰트 설치가 필요 없다.

## 기준과 비교

2026년 11월 20일, 동봉된 편집 SVG의 25개 텍스트와 윤곽선 SVG의 글자 배치 168개를 대조했다. 중복을 제외한 글리프 102개의 선과 곡선이 일치했다. 기준점, 글자 크기, 자간과 정렬을 적용한 위치는 참조 SVG 좌표 반올림 범위 안에서 일치했다. 세 글꼴에서 현대 한글 음절 전체의 존재도 확인했다. 이 결과의 비교 범위는 기준 SVG에 등장하는 글자의 모양과 배치다.

## 재생성과 검사

일상적인 실행·배포에는 public/fonts에 포함된 파일을 사용한다. 다음 명령은 프로젝트 루트에서 실행한다. 재생성기는 고정된 원본 SHA-256을 대조한 뒤 청크를 저장한다. Python 3.9.6 및 fontTools 4.58.5에서 실행했다.

```sh
python3 -m venv /tmp/wedding-map-fonts-env
/tmp/wedding-map-fonts-env/bin/python -m pip install fonttools==4.58.5
/tmp/wedding-map-fonts-env/bin/python scripts/prepare-fonts.py --cache /tmp/wedding-map-fonts-cache
/tmp/wedding-map-fonts-env/bin/python scripts/prepare-fonts.verify.py
```

파일 묶음의 캐시 키에는 src/fonts.ts의 FONT_EDITION 값을 사용한다. 글꼴·지원 범위·배치 계산이 바뀌면 출력물 재사용을 위해 이 값을 새 버전으로 변경한다.

## v2 원본 대조

추가로 제공된 Wedding_Map_Automation_v2.zip의 assets/fonts.json에 기록된 SHA-256을 압축 내부의 실제 파일과 대조했다. v2는 원본에서 글자를 추린 OTF 3개를 포함한다. 각 OTF의 문자표 12,092개 모두에서 원본 Noto의 곡선 명령·제어점과 가로 진행 폭이 정확히 일치했다. v2가 제공하는 모든 코드는 배포 청크에도 포함된다.

| v2 파일 | SHA-256 |
| --- | --- |
| sans_regular.otf | e0bd38cb513875a76ce30da4a44338ad223165d551a3bc755954969312a28b6c |
| serif_regular.otf | 02bd240a88ea21598757f142fcf2b9d9121fd300be2595bb0fda298b832cedcb |
| serif_bold.otf | 7dca2c51cceccef22cb2b86950dbdba6bec577ee631e03ab27279c96dc6385d2 |

v2에 들어 있는 466바이트 라이선스 안내를 공식 배포본의 OFL 전문과 폰트별 저작권 고지로 보완했다.
