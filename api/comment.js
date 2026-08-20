// api/comment.js

export default async function handler(req, res) {
  // CORS 설정 (OBS 위젯에서 이 서버로 요청할 수 있도록 허용)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 1. 위젯에서 넘겨준 일반 게시글 주소 가져오기
  const { url, highlight } = req.query;

  if (!url) {
    return res.status(400).json({ error: "URL 파라미터가 필요합니다." });
  }

  try {
    // 2. 게시글 주소에서 '채널명'과 '게시글 번호' 추출
    // 입력 예시: https://www.sooplive.com/station/ecvhao/post/201137725
    // match[1] = ecvhao (채널명)
    // match[2] = 201137725 (게시물 번호)
  const cleanUrl = url.split('#')[0]; // # 꼬리표 제거
    const match = cleanUrl.match(/\/station\/([a-zA-Z0-9_-]+)\/post\/(\d+)/);
    
    const channelId = match ? match[1] : null;
    const postId = match ? match[2] : null;

    if (!channelId || !postId) {
      return res.status(400).json({ error: "게시글 주소 형식이 올바르지 않습니다. (채널명 또는 게시물 번호를 찾을 수 없음)" });
    }

    // 🎯 3. 찾아내신 SOOP Request URL 완벽 조립
    // orderBy=like_cnt : 추천수(인기)순 정렬
    // pHighlightNo : 하이라이트할 댓글 번호 (있으면 몇 페이지에 있든 응답에 포함되어 옴)
    // page : 페이지 번호 (1페이지당 댓글 개수가 제한되어 있어서, 순위 하위권까지 보려면
    //         여러 페이지를 이어서 받아와야 함 -> 아래 반복문에서 처리)
    const highlightParam = highlight ? `&pHighlightNo=${encodeURIComponent(highlight)}` : '';

    // 4. SOOP 서버에 페이지를 순차적으로 요청해서 전체 댓글 목록을 모음
    //    (34등 아래가 안 보이던 이유: 예전엔 page=1만 가져와서 1페이지 분량 이후 댓글이
    //     아예 응답에 없었음. 여기서 빈 페이지가 나올 때까지 계속 이어붙임)
    const MAX_PAGES = parseInt(req.query.maxPages, 10) || 15; // 안전장치 (필요시 늘려도 됨)
    let allComments = [];
    let firstPageData = null;
    let listKeyUsed = 'data';

    for (let page = 1; page <= MAX_PAGES; page++) {
      const targetApiUrl = `https://api-channel.sooplive.com/v1.1/channel/${channelId}/post/${postId}/comment?page=${page}&orderBy=like_cnt&cCommentNo=0${highlightParam}`;

      const response = await fetch(targetApiUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': url,
          'Accept': 'application/json, text/plain, */*'
        }
      });

      if (!response.ok) {
        // 첫 페이지부터 실패한 거면 에러, 이미 일부 페이지를 모은 상태면 그냥 여기서 멈추고 가진 것만 반환
        if (page === 1) throw new Error(`API 요청 실패: ${response.status}`);
        break;
      }

      const pageData = await response.json();
      if (page === 1) firstPageData = pageData;

      // SOOP 응답에서 댓글 배열이 들어있는 키를 찾음 (구조가 바뀌어도 대응)
      let pageList = null;
      for (const key of ['data', 'comment_list', 'list', 'result']) {
        if (Array.isArray(pageData[key])) {
          pageList = pageData[key];
          listKeyUsed = key;
          break;
        }
      }

      if (!Array.isArray(pageList) || pageList.length === 0) {
        // 더 이상 댓글이 없는 마지막 페이지 -> 반복 종료
        break;
      }

      allComments = allComments.concat(pageList);
    }

    // 위젯이 기대하는 구조를 유지하면서, 합쳐진 전체 댓글 목록을 data 키에 담아 반환
    const data = { ...(firstPageData || {}), [listKeyUsed]: allComments };

    // 5. 위젯으로 데이터 전달 및 캐싱 설정 (5초 단위 갱신으로 IP 차단 방지)
    res.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate');
    res.status(200).json(data);

  } catch (error) {
    console.error("크롤링 에러:", error);
    res.status(500).json({ error: "서버에서 데이터를 가져오는 중 문제가 발생했습니다." });
  }
}