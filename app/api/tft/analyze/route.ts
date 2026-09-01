import { NextRequest, NextResponse } from 'next/server'
import { getAccountByRiotId, getTftMatchIds, getTftMatchDetail, getSummonerByPuuid, RiotApiError } from '@/lib/riot'
import { extractSlimMatchData } from '@/lib/summarize'
import { generateMetaCoachFeedback } from '@/lib/llm'
import { SlimMatchData, TFTAnalysisResponse, SummonerProfile, LobbyParticipant } from '@/lib/types'
import { DDRAGON_VERSION } from '@/lib/constants'

function createDemoLobby(userPlacement: number, userName: string): LobbyParticipant[] {
  const sampleOpponents = [
    { name: '태아나보니이명훈', level: 9, lastRound: '6-4', dmg: 142, traits: ['선봉대', '암살자'], units: ['갱플랭크', '노틸러스', '트위스티드 페이트'] },
    { name: '김호석', level: 9, lastRound: '6-2', dmg: 128, traits: ['빌지워터', '난동꾼'], units: ['미스 포츈', '일라오이', '그레이브즈'] },
    { name: '민 석', level: 9, lastRound: '5-6', dmg: 110, traits: ['집행자', '저격수'], units: ['케이틀린', '바이', '징크스'] },
    { name: '메크 조종사', level: 8, lastRound: '5-4', dmg: 96, traits: ['도전자', '전쟁기계'], units: ['암베사', '가렌', '다리우스'] },
    { name: 'yosua분신', level: 8, lastRound: '5-3', dmg: 85, traits: ['마법사', '요술사'], units: ['조이', '르블랑', '스웨인'] },
    { name: 'hayabusa', level: 8, lastRound: '5-1', dmg: 72, traits: ['돌격대', '파수꾼'], units: ['워윅', '블리츠크랭크', '제이스'] },
    { name: '3대470나니', level: 7, lastRound: '4-3', dmg: 54, traits: ['난동꾼'], units: ['사이온', '세트'] },
  ]

  const lobby: LobbyParticipant[] = []
  let oppIndex = 0

  for (let rank = 1; rank <= 8; rank++) {
    if (rank === userPlacement) {
      lobby.push({
        placement: rank,
        gameName: userName,
        tagLine: 'KR1',
        level: userPlacement <= 4 ? 9 : 8,
        lastRound: '5-1',
        damageToPlayers: 80,
        traits: [{ name: '돌격대', tier: 2, count: 4 }, { name: '저격수', tier: 1, count: 2 }],
        units: [
          { id: 'TFT_TwistedFate', name: '트위스티드 페이트', tier: 2, rarity: 4, imgUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/TwistedFate.png`, items: ['구인수의 격노검', '죽음의 검'] },
          { id: 'TFT_Nautilus', name: '노틸러스', tier: 2, rarity: 3, imgUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/Nautilus.png`, items: ['워모그의 갑옷', '덤불 조끼'] },
        ],
        isUser: true,
      })
    } else {
      const opp = sampleOpponents[oppIndex++] || sampleOpponents[0]
      lobby.push({
        placement: rank,
        gameName: opp.name,
        tagLine: 'KR1',
        level: opp.level,
        lastRound: opp.lastRound,
        damageToPlayers: opp.dmg,
        traits: opp.traits.map(t => ({ name: t, tier: 2, count: 4 })),
        units: opp.units.map(u => ({
          id: `TFT_${u}`,
          name: u,
          tier: rank <= 3 ? 2 : 1,
          rarity: 4,
          imgUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/TwistedFate.png`,
          items: ['피바라기', '거인의 결의'],
        })),
        isUser: false,
      })
    }
  }

  return lobby
}

function getDemoMatches(gameName: string): SlimMatchData[] {
  return [
    {
      matchId: 'KR_DEMO_001',
      setNumber: 18,
      gameDatetime: Date.now() - 1000 * 60 * 35,
      timeAgo: '35분 전',
      gameLengthStr: '28분 15초',
      queueType: '랭크 게임',
      placement: 7,
      level: 8,
      lastRound: '5-1',
      goldLeft: 34,
      augments: ['보석 연꽃 II', '아이템 숙련', '판도라의 아이템'],
      traits: [
        { name: '돌격대', tier: 2, count: 4 },
        { name: '저격수', tier: 1, count: 2 },
        { name: '파수꾼', tier: 1, count: 2 },
      ],
      units: [
        { id: 'TFT16_TwistedFate', name: '트위스티드 페이트', tier: 1, rarity: 4, imgUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/TwistedFate.png`, items: ['구인수의 격노검', '죽음의 검'] },
        { id: 'TFT16_Gangplank', name: '갱플랭크', tier: 2, rarity: 3, imgUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/Gangplank.png`, items: ['쇼진의 창'] },
        { id: 'TFT16_Nautilus', name: '노틸러스', tier: 2, rarity: 3, imgUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/Nautilus.png`, items: ['워모그의 갑옷', '덤불 조끼'] },
        { id: 'TFT16_Graves', name: '그레이브즈', tier: 2, rarity: 2, imgUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/Graves.png`, items: [] },
      ],
      lobbyParticipants: createDemoLobby(7, gameName),
      contestedInfo: {
        isContested: true,
        contestedUnits: ['트위스티드 페이트'],
        contestedTraits: ['돌격대'],
        opponentCount: 2,
      },
    },
    {
      matchId: 'KR_DEMO_002',
      setNumber: 18,
      gameDatetime: Date.now() - 1000 * 60 * 95,
      timeAgo: '1시간 전',
      gameLengthStr: '34분 50초',
      queueType: '랭크 게임',
      placement: 4,
      level: 9,
      lastRound: '6-2',
      goldLeft: 4,
      augments: ['사이버네틱 통신', '골드 티켓', '최후의 저항'],
      traits: [
        { name: '선봉대', tier: 3, count: 6 },
        { name: '암살자', tier: 1, count: 2 },
      ],
      units: [
        { id: 'TFT_Ambessa', name: '암베사', tier: 2, rarity: 4, imgUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/Ambessa.png`, items: ['피바라기', '스테락의 도전', '거인의 결의'] },
        { id: 'TFT_Caitlyn', name: '케이틀린', tier: 2, rarity: 5, imgUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/Caitlyn.png`, items: ['무한의 대검', '최후의 속삭임'] },
        { id: 'TFT_Garen', name: '가렌', tier: 3, rarity: 4, imgUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/Garen.png`, items: ['워모그의 갑옷', '용의 발톱'] },
      ],
      lobbyParticipants: createDemoLobby(4, gameName),
      contestedInfo: {
        isContested: false,
        contestedUnits: [],
        contestedTraits: [],
        opponentCount: 0,
      },
    },
    {
      matchId: 'KR_DEMO_003',
      setNumber: 18,
      gameDatetime: Date.now() - 1000 * 60 * 155,
      timeAgo: '2시간 전',
      gameLengthStr: '24분 30초',
      queueType: '랭크 게임',
      placement: 8,
      level: 7,
      lastRound: '4-3',
      goldLeft: 52,
      augments: ['쇼핑몰 죽돌이', '이중 공중보급', '돈벼락'],
      traits: [
        { name: '마법사', tier: 1, count: 3 },
        { name: '난동꾼', tier: 1, count: 2 },
      ],
      units: [
        { id: 'TFT_Zoe', name: '조이', tier: 1, rarity: 3, imgUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/Zoe.png`, items: ['푸른 파수꾼'] },
        { id: 'TFT_Sion', name: '사이온', tier: 2, rarity: 2, imgUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/Sion.png`, items: ['쇠사슬 조끼'] },
      ],
      lobbyParticipants: createDemoLobby(8, gameName),
      contestedInfo: {
        isContested: true,
        contestedUnits: ['조이'],
        contestedTraits: ['마법사'],
        opponentCount: 3,
      },
    },
    {
      matchId: 'KR_DEMO_004',
      setNumber: 18,
      gameDatetime: Date.now() - 1000 * 60 * 215,
      timeAgo: '3시간 전',
      gameLengthStr: '36분 10초',
      queueType: '랭크 게임',
      placement: 2,
      level: 9,
      lastRound: '6-5',
      goldLeft: 8,
      augments: ['보물 사냥꾼', '초월', '휴대용 대장간'],
      traits: [
        { name: '암살자', tier: 2, count: 4 },
        { name: '망령', tier: 2, count: 4 },
      ],
      units: [
        { id: 'TFT_Akali', name: '아칼리', tier: 3, rarity: 3, imgUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/Akali.png`, items: ['무한의 대검', '정의의 손길', '밤의 끝자락'] },
        { id: 'TFT_Mordekaiser', name: '모데카이저', tier: 2, rarity: 5, imgUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/Mordekaiser.png`, items: ['태양불꽃 망토', '용의 발톱'] },
      ],
      lobbyParticipants: createDemoLobby(2, gameName),
      contestedInfo: {
        isContested: false,
        contestedUnits: [],
        contestedTraits: [],
        opponentCount: 0,
      },
    },
    {
      matchId: 'KR_DEMO_005',
      setNumber: 18,
      gameDatetime: Date.now() - 1000 * 60 * 275,
      timeAgo: '4시간 전',
      gameLengthStr: '30분 40초',
      queueType: '랭크 게임',
      placement: 5,
      level: 8,
      lastRound: '5-3',
      goldLeft: 18,
      augments: ['신병', '살인술사', '적응형 방어'],
      traits: [
        { name: '도전자', tier: 2, count: 4 },
        { name: '전쟁기계', tier: 2, count: 4 },
      ],
      units: [
        { id: 'TFT_Jinx', name: '징크스', tier: 2, rarity: 4, imgUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/Jinx.png`, items: ['거인 학살자', '구인수의 격노검'] },
        { id: 'TFT_Blitzcrank', name: '블리츠크랭크', tier: 2, rarity: 3, imgUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/Blitzcrank.png`, items: ['가고일 돌갑옷'] },
      ],
      lobbyParticipants: createDemoLobby(5, gameName),
      contestedInfo: {
        isContested: true,
        contestedUnits: ['징크스'],
        contestedTraits: ['도전자'],
        opponentCount: 1,
      },
    },
  ]
}

function calculateProfileStats(matches: SlimMatchData[], gameName: string, tagLine: string, level = 100, iconId = 7193): SummonerProfile {
  const total = matches.length || 1
  const avgPlacement = Math.round((matches.reduce((acc, m) => acc + m.placement, 0) / total) * 10) / 10
  const winCount = matches.filter(m => m.placement === 1).length
  const top4Count = matches.filter(m => m.placement <= 4).length

  return {
    gameName,
    tagLine,
    summonerLevel: level,
    profileIconUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/profileicon/${iconId}.png`,
    avgPlacement,
    winRate: Math.round((winCount / total) * 100),
    top4Rate: Math.round((top4Count / total) * 100),
    totalGames: total,
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    let { gameName, tagLine, mode = 'single', isDemo = false } = body

    if (!gameName) {
      return NextResponse.json({ success: false, error: '소환사 닉네임을 입력해주세요.' }, { status: 400 })
    }

    if (gameName.includes('#')) {
      const parts = gameName.split('#')
      gameName = parts[0].trim()
      tagLine = parts[1].trim()
    }

    if (!tagLine) {
      tagLine = 'KR1'
    }

    const count = mode === 'multi' ? 5 : 1
    const hasApiKey = Boolean(process.env.RIOT_API_KEY)

    if (isDemo || !hasApiKey) {
      const allDemos = getDemoMatches(gameName)
      const targetMatches = mode === 'multi' ? allDemos : allDemos.slice(0, 1)
      const feedback = await generateMetaCoachFeedback(gameName, targetMatches, mode)
      const summonerProfile = calculateProfileStats(targetMatches, gameName, tagLine, 120, 7193)

      const response: TFTAnalysisResponse = {
        success: true,
        gameName,
        tagLine,
        puuid: 'DEMO_PUUID_' + Date.now(),
        mode,
        matches: targetMatches,
        feedback,
        summonerProfile,
        isDemo: !hasApiKey || isDemo,
      }
      return NextResponse.json(response)
    }

    // 1. Riot Account 조회 (PUUID)
    const account = await getAccountByRiotId(gameName, tagLine)

    // 2. 소환사 기본 정보 (프로필 아이콘, 레벨) 조회
    const summonerInfo = await getSummonerByPuuid(account.puuid)

    // 3. 최근 TFT 매치 ID 목록 (1판 또는 5판)
    const matchIds = await getTftMatchIds(account.puuid, count)

    if (!matchIds || matchIds.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: `소환사 '${account.gameName}#${account.tagLine}'의 최근 TFT 매치 기록을 찾을 수 없습니다.`,
        },
        { status: 404 }
      )
    }

    // 4. 매치 세부 데이터 병렬 조회 및 정제 (로비 8명 전체 순위 포함)
    const matchDetails = await Promise.all(
      matchIds.map(async (id) => {
        try {
          const rawMatch = await getTftMatchDetail(id)
          return extractSlimMatchData(rawMatch, account.puuid)
        } catch (err) {
          console.error(`Failed to fetch match detail ${id}:`, err)
          return null
        }
      })
    )

    const validMatches = matchDetails.filter((m): m is SlimMatchData => m !== null)

    if (validMatches.length === 0) {
      return NextResponse.json(
        { success: false, error: 'TFT 매치 세부 정보를 불러오지 못했습니다.' },
        { status: 500 }
      )
    }

    // 5. LLM 전문 메타 분석 코칭
    const feedback = await generateMetaCoachFeedback(account.gameName, validMatches, mode)
    const summonerProfile = calculateProfileStats(validMatches, account.gameName, account.tagLine, summonerInfo.summonerLevel, summonerInfo.profileIconId)

    const result: TFTAnalysisResponse = {
      success: true,
      gameName: account.gameName,
      tagLine: account.tagLine,
      puuid: account.puuid,
      mode,
      matches: validMatches,
      feedback,
      summonerProfile,
      isDemo: false,
    }

    return NextResponse.json(result)
  } catch (err: any) {
    console.error('TFT Analyze API Error:', err)
    if (err instanceof RiotApiError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.statusCode })
    }
    return NextResponse.json(
      { success: false, error: err.message || '매치 분석 중 예기치 못한 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}
