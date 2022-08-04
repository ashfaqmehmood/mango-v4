import { I80F48, I80F48Dto, ZERO_I80F48 } from './I80F48';
import { HealthType } from './mangoAccount';

//               ░░░░
//
//                                           ██
//                                         ██░░██
// ░░          ░░                        ██░░░░░░██                            ░░░░
//                                     ██░░░░░░░░░░██
//                                     ██░░░░░░░░░░██
//                                   ██░░░░░░░░░░░░░░██
//                                 ██░░░░░░██████░░░░░░██
//                                 ██░░░░░░██████░░░░░░██
//                               ██░░░░░░░░██████░░░░░░░░██
//                               ██░░░░░░░░██████░░░░░░░░██
//                             ██░░░░░░░░░░██████░░░░░░░░░░██
//                           ██░░░░░░░░░░░░██████░░░░░░░░░░░░██
//                           ██░░░░░░░░░░░░██████░░░░░░░░░░░░██
//                         ██░░░░░░░░░░░░░░██████░░░░░░░░░░░░░░██
//                         ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██
//                       ██░░░░░░░░░░░░░░░░██████░░░░░░░░░░░░░░░░██
//                       ██░░░░░░░░░░░░░░░░██████░░░░░░░░░░░░░░░░██
//                     ██░░░░░░░░░░░░░░░░░░██████░░░░░░░░░░░░░░░░░░██
//       ░░            ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██
//                       ██████████████████████████████████████████
// warning: this code is copy pasta from rust, keep in sync with health.rs

export class HealthCache {
  tokenInfos: TokenInfo[];
  serum3Infos: Serum3Info[];
  perpInfos: PerpInfo[];

  constructor(dto: HealthCacheDto) {
    this.tokenInfos = dto.tokenInfos.map((dto) => new TokenInfo(dto));
    this.serum3Infos = dto.serum3Infos.map((dto) => new Serum3Info(dto));
    this.perpInfos = dto.perpInfos.map((dto) => new PerpInfo(dto));
  }

  public health(healthType: HealthType): I80F48 {
    let health = ZERO_I80F48;
    for (const tokenInfo of this.tokenInfos) {
      let contrib = tokenInfo.healthContribution(healthType);
      health = health.add(contrib);
    }
    for (const serum3Info of this.serum3Infos) {
      let contrib = serum3Info.healthContribution(healthType, this.tokenInfos);
      health = health.add(contrib);
    }
    for (const perpInfo of this.perpInfos) {
      let contrib = perpInfo.healthContribution(healthType);
      health = health.add(contrib);
    }
    return health;
  }
}

export class TokenInfo {
  constructor(dto: TokenInfoDto) {
    this.tokenIndex = dto.tokenIndex;
    this.maintAssetWeight = I80F48.from(dto.maintAssetWeight);
    this.initAssetWeight = I80F48.from(dto.initAssetWeight);
    this.maintLiabWeight = I80F48.from(dto.maintLiabWeight);
    this.initLiabWeight = I80F48.from(dto.initLiabWeight);
    this.oraclePrice = I80F48.from(dto.oraclePrice);
    this.balance = I80F48.from(dto.balance);
    this.serum3MaxReserved = I80F48.from(dto.serum3MaxReserved);
  }

  tokenIndex: number;
  maintAssetWeight: I80F48;
  initAssetWeight: I80F48;
  maintLiabWeight: I80F48;
  initLiabWeight: I80F48;
  oraclePrice: I80F48; // native/native
  // in health-reference-token native units
  balance: I80F48;
  // in health-reference-token native units
  serum3MaxReserved: I80F48;

  assetWeight(healthType: HealthType): I80F48 {
    return healthType == HealthType.init
      ? this.initAssetWeight
      : this.maintAssetWeight;
  }

  liabWeight(healthType: HealthType): I80F48 {
    return healthType == HealthType.init
      ? this.initLiabWeight
      : this.maintLiabWeight;
  }

  healthContribution(healthType: HealthType): I80F48 {
    return (
      this.balance.isNeg()
        ? this.liabWeight(healthType)
        : this.assetWeight(healthType)
    ).mul(this.balance);
  }
}

export class Serum3Info {
  constructor(dto: Serum3InfoDto) {
    this.reserved = I80F48.from(dto.reserved);
    this.baseIndex = dto.baseIndex;
    this.quoteIndex = dto.quoteIndex;
  }

  reserved: I80F48;
  baseIndex: number;
  quoteIndex: number;

  healthContribution(healthType: HealthType, tokenInfos: TokenInfo[]): I80F48 {
    let baseInfo = tokenInfos[this.baseIndex];
    let quoteInfo = tokenInfos[this.quoteIndex];
    let reserved = this.reserved;

    if (reserved.isZero()) {
      return ZERO_I80F48;
    }

    // How much the health would increase if the reserved balance were applied to the passed
    // token info?
    let computeHealthEffect = function (tokenInfo: TokenInfo) {
      // This balance includes all possible reserved funds from markets that relate to the
      // token, including this market itself: `reserved` is already included in `max_balance`.
      let maxBalance = tokenInfo.balance.add(tokenInfo.serum3MaxReserved);

      // Assuming `reserved` was added to `max_balance` last (because that gives the smallest
      // health effects): how much did health change because of it?
      let assetPart, liabPart;
      if (maxBalance.gte(reserved)) {
        assetPart = reserved;
        liabPart = ZERO_I80F48;
      } else if (maxBalance.isNeg()) {
        assetPart = ZERO_I80F48;
        liabPart = reserved;
      } else {
        assetPart = maxBalance;
        liabPart = reserved.sub(maxBalance);
      }

      let assetWeight = tokenInfo.assetWeight(healthType);
      let liabWeight = tokenInfo.liabWeight(healthType);
      return assetWeight.mul(assetPart).add(liabWeight.mul(liabPart));
    };

    let reservedAsBase = computeHealthEffect(baseInfo);
    let reservedAsQuote = computeHealthEffect(quoteInfo);
    return reservedAsBase.min(reservedAsQuote);
  }
}

export class PerpInfo {
  constructor(dto: PerpInfoDto) {
    this.maintAssetWeight = I80F48.from(dto.maintAssetWeight);
    this.initAssetWeight = I80F48.from(dto.initAssetWeight);
    this.maintLiabWeight = I80F48.from(dto.maintLiabWeight);
    this.initLiabWeight = I80F48.from(dto.initLiabWeight);
    this.base = I80F48.from(dto.base);
    this.quote = I80F48.from(dto.quote);
  }
  maintAssetWeight: I80F48;
  initAssetWeight: I80F48;
  maintLiabWeight: I80F48;
  initLiabWeight: I80F48;
  // in health-reference-token native units, needs scaling by asset/liab
  base: I80F48;
  // in health-reference-token native units, no asset/liab factor needed
  quote: I80F48;

  healthContribution(healthType: HealthType): I80F48 {
    let weight;
    if (healthType == HealthType.init && this.base.isNeg()) {
      weight = this.initLiabWeight;
    } else if (healthType == HealthType.init && !this.base.isNeg()) {
      weight = this.initAssetWeight;
    }
    if (healthType == HealthType.maint && this.base.isNeg()) {
      weight = this.maintLiabWeight;
    }
    if (healthType == HealthType.maint && !this.base.isNeg()) {
      weight = this.maintAssetWeight;
    }

    // FUTURE: Allow v3-style "reliable" markets where we can return
    // `self.quote + weight * self.base` here
    return this.quote.add(weight.mul(this.base)).min(ZERO_I80F48);
  }
}

export class HealthCacheDto {
  tokenInfos: TokenInfoDto[];
  serum3Infos: Serum3InfoDto[];
  perpInfos: PerpInfoDto[];
}
export class TokenInfoDto {
  tokenIndex: number;
  maintAssetWeight: I80F48Dto;
  initAssetWeight: I80F48Dto;
  maintLiabWeight: I80F48Dto;
  initLiabWeight: I80F48Dto;
  oraclePrice: I80F48Dto; // native/native
  // in health-reference-token native units
  balance: I80F48Dto;
  // in health-reference-token native units
  serum3MaxReserved: I80F48Dto;
}

export class Serum3InfoDto {
  reserved: I80F48Dto;
  baseIndex: number;
  quoteIndex: number;
}

export class PerpInfoDto {
  maintAssetWeight: I80F48Dto;
  initAssetWeight: I80F48Dto;
  maintLiabWeight: I80F48Dto;
  initLiabWeight: I80F48Dto;
  // in health-reference-token native units, needs scaling by asset/liab
  base: I80F48Dto;
  // in health-reference-token native units, no asset/liab factor needed
  quote: I80F48Dto;
}