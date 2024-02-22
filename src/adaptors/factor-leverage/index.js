const vaults = require('./vaults');

async function getLeverageVaultAPY() {
    const poolData = await Promise.all(
        vaults.map(async (vault) => {
            const project = 'factor-leverage';
            const chain = 'arbitrum';
            const pool = `${vault.pool}-${chain}`.toLowerCase();
            const url = `https://app.factor.fi/studio/vault-leveraged/${vault.protocol}/${vault.market}/open-pair?asset=${vault.assetAddress}&debt=${vault.debtAddress}&vault=${vault.pool}`;
            const symbol = `${vault.protocol} ${vault.assetSymbol}/${vault.debtSymbol}`;
            const underlyingTokens = [vault.assetAddress, vault.debtAddress];

            // const [tvlUsd, apyBase] = await Promise.all([
            //     getTvl(vault.poolAddress, vault.underlyingToken, vault.strategy),
            //     getApr(vault.poolAddress, vault.underlyingToken, vault.strategy),
            // ]);

            const [tvlUsd, apyBase] = [0, 0];

            const data = {
                pool,
                chain,
                project,
                symbol,
                tvlUsd,
                apyBase,
                underlyingTokens,
                url,
            };

            return data;
        })
    );

    return poolData;
}

module.exports = {
    timetravel: false,
    apy: getLeverageVaultAPY,
};

