const { request, gql } = require('graphql-request');
const { getCoinPriceMap } = require('./shared');
const vaults = require('./vaults');
const {
    AaveV3LeverageVaultHelper,
    DummyLeverageVaultHelper,
    CompoundV3LeverageVaultHelper,
    LodestarLeverageVaultHelper,
} = require('./adapters');

class FactorLeverageVaultHelper {
    constructor(vaults) {
        this._vaults = vaults;
        this._pairTvlMap = undefined;
        this._initialized = false;
        this._marketAdapterMap = {
            facAAVEv3: new AaveV3LeverageVaultHelper(vaults),
            facCompound: new CompoundV3LeverageVaultHelper(
                '0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA'
            ),
            facCompoundNative: new CompoundV3LeverageVaultHelper(
                '0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf'
            ),
            facLodestar: new LodestarLeverageVaultHelper(
                '0x24C25910aF4068B5F6C3b75252a36c4810849135',
                [
                    // lusdce
                    '0x1ca530f02DD0487cef4943c674342c5aEa08922F',
                    // lusdc
                    '0x4C9aAed3b8c443b4b634D1A189a5e25C604768dE',
                    // lmagic
                    '0xf21Ef887CB667f84B8eC5934C1713A7Ade8c38Cf',
                    // lwbtc
                    '0xC37896BF3EE5a2c62Cdbd674035069776f721668',
                    // lusdt
                    '0x9365181A7df82a1cC578eAE443EFd89f00dbb643',
                    // ldpx
                    '0x5d27cFf80dF09f28534bb37d386D43aA60f88e25',
                    // larb
                    '0x8991d64fe388fA79A4f7Aa7826E8dA09F0c3C96a',
                    // ldai
                    '0x4987782da9a63bC3ABace48648B15546D821c720',
                    // lfrax
                    '0xD12d43Cdf498e377D3bfa2c6217f05B466E14228',
                    // lwsteth
                    '0xfECe754D92bd956F681A941Cef4632AB65710495',
                    // lgmx
                    '0x79B6c5e1A7C0aD507E1dB81eC7cF269062BAb4Eb',
                ]
            ),
            dummy: new DummyLeverageVaultHelper(vaults),
        };
    }

    async initialize() {
        await Promise.all([
            this._initializeTvlPairMap(),
            ...Object.values(this._marketAdapterMap).map((adapter) =>
                adapter.initialize()
            ),
        ]);
        this._initialized = true;
    }

    createPoolsData() {
        const poolsData = this._vaults.map((vault) => {
            return this._createPoolData({
                protocol: vault.protocol,
                market: vault.market,
                assetAddress: vault.assetAddress,
                assetSymbol: vault.assetSymbol,
                debtAddress: vault.debtAddress,
                debtSymbol: vault.debtSymbol,
                vaultAddress: vault.pool,
            });
        });

        return poolsData;
    }

    // ================== Private Methods ================== //

    async _initializeTvlPairMap() {
        const leverageSubgraphUrl =
            'https://api.thegraph.com/subgraphs/name/dimasriat/factor-leverage-vault';

        const leverageSubgraphQuery = gql`
            {
                leverageVaultPairStates {
                    id
                    assetBalanceRaw
                    assetTokenAddress
                    debtBalanceRaw
                    debtTokenAddress
                }
            }
        `;

        const { leverageVaultPairStates } = await request(
            leverageSubgraphUrl,
            leverageSubgraphQuery
        );

        const tokenAddresses = new Set(
            leverageVaultPairStates.flatMap((pair) => [
                pair.assetTokenAddress.toLowerCase(),
                pair.debtTokenAddress.toLowerCase(),
            ])
        );
        const coinPriceMap = await getCoinPriceMap([...tokenAddresses]);

        const tvlMap = {};

        leverageVaultPairStates.forEach((pair) => {
            const assetAddress = pair.assetTokenAddress.toLowerCase();
            const debtAddress = pair.debtTokenAddress.toLowerCase();
            const assetAmount = Number(pair.assetBalanceRaw);
            const debtAmount = Number(pair.debtBalanceRaw);

            const assetAmountFmt = assetAmount / 10 ** 18;
            const debtAmountFmt = debtAmount / 10 ** 18;

            const assetAmountUsd =
                assetAmountFmt * coinPriceMap[assetAddress].price;
            const debtAmountUsd =
                debtAmountFmt * coinPriceMap[debtAddress].price;
            const netValueUsd = assetAmountUsd - debtAmountUsd;

            const mapId = `${assetAddress}-${debtAddress}`.toLowerCase();
            tvlMap[mapId] = netValueUsd;
        });

        vaults.forEach((vault) => {
            const mapId =
                `${vault.assetAddress}-${vault.debtAddress}`.toLowerCase();
            if (tvlMap[mapId] === undefined) {
                tvlMap[mapId] = 0;
            }
        });

        this._pairTvlMap = tvlMap;
    }

    _getAdapterByMarket(market) {
        const adapter = this._marketAdapterMap[market];
        if (!adapter) {
            // throw new Error(`No adapter found for protocol ${protocol}`);
            return this._marketAdapterMap['dummy'];
        }
        return adapter;
    }

    _createPoolData({
        protocol,
        market,
        assetAddress,
        assetSymbol,
        debtAddress,
        debtSymbol,
        vaultAddress,
    }) {
        const project = 'factor-leverage-vault';
        const chain = 'arbitrum';
        const pool =
            `${market}-${assetAddress}-${debtAddress}-${chain}`.toLowerCase();
        const url = `https://app.factor.fi/studio/vault-leveraged/${protocol}/${market}/open-pair?asset=${assetAddress}&debt=${debtAddress}&vault=${vaultAddress}`;
        const symbol = `${protocol} ${assetSymbol}/${debtSymbol}`;
        const underlyingTokens = [assetAddress, debtAddress];

        const tvlUsd = this._getPairTvlUsd(assetAddress, debtAddress);

        const apyBase = this._getPairApyBase(market, assetAddress, debtAddress);

        return {
            pool,
            chain,
            project,
            symbol,
            tvlUsd,
            apyBase,
            underlyingTokens,
            url,
        };
    }

    _getPairTvlUsd(assetAddress, debtAddress) {
        if (!this._initialized) {
            throw new Error('Tvl pair map not initialized');
        }

        const mapId = `${assetAddress}-${debtAddress}`.toLowerCase();
        return this._pairTvlMap[mapId] ?? 0;
    }

    _getPairApyBase(market, assetAddress, debtAddress) {
        const adapter = this._getAdapterByMarket(market);
        if (!adapter) {
            // throw new Error(`No adapter found for protocol ${protocol}`);
            return 0;
        }
        return adapter.getApyBase(assetAddress, debtAddress);
    }
}

async function getLeverageVaultAPY() {
    const factorLeverageVaultHelper = new FactorLeverageVaultHelper(vaults);

    await factorLeverageVaultHelper.initialize();

    return factorLeverageVaultHelper.createPoolsData();
}

module.exports = {
    timetravel: false,
    apy: getLeverageVaultAPY,
};
