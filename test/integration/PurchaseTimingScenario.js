import { advanceBlock } from '.././tools/advanceToBlock';
import { increaseTimeTo, duration } from '.././tools/increaseTime';
import latestTime from '.././tools/latestTime';

const AkropolisToken = artifacts.require('./AkropolisToken.sol');
const AkropolisCrowdsale = artifacts.require('./AkropolisCrowdsale.sol');
const Whitelist = artifacts.require('./Whitelist.sol');
const SaleConfiguration = artifacts.require('./SaleConfiguration.sol');
const AllocationsManager = artifacts.require('./AllocationsManager.sol');
const LinearTokenVesting = artifacts.require('./LinearTokenVesting.sol');

const BigNumber = web3.BigNumber;

const should = require('chai')
	.use(require('chai-as-promised'))
	.use(require('chai-bignumber')(BigNumber))
	.should();

function ether (n) {
	return new web3.BigNumber(web3.toWei(n, 'ether'));
}

//This integration test seeks to explore buying at inappropriate times for the crowdsale
//We check that the crowdsale is set up, tokens are bought and finalizes as normal
//This test ensures we cannot buy tokens before round 1 or after the sale has been finalized
contract('Akropolis Buying Timing Scenario', function ([owner, admin, wallet, buyer1, buyer2, buyer3, buyer4,
																						reserveFund, bountyFund, developmentFund, unknown]) {

	const ALLOCATED_VALUE = 100;

	const CONTRIBUTION_AMOUNT = ether(1);

	let token, crowdsale, whitelist, config;
	let presaleAllocations, teamAllocations, advisorsAllocations;
	let startTime, endTime, afterEndTime;
	let tokenBuyerAmount;

	before(async function () {
		// Advance to the next block to correctly read time in the solidity "now" function interpreted by testrpc
		await advanceBlock();

		startTime = latestTime() + duration.weeks(1);
		endTime = startTime + duration.days(4);
		afterEndTime = endTime + duration.seconds(1);
		token = await AkropolisToken.new();
		await token.pause();
		whitelist = await Whitelist.new();
		await whitelist.setAdmin(admin);
		await whitelist.addToWhitelist(buyer1, {from: admin});
		await whitelist.addToWhitelist(buyer2, {from: admin});
		await whitelist.addToWhitelist(buyer3, {from: admin});
		await whitelist.addToWhitelist(buyer4, {from: admin});

		presaleAllocations = await AllocationsManager.new();
		await presaleAllocations.setToken(token.address);
		await presaleAllocations.setAdmin(admin);

		teamAllocations = await AllocationsManager.new();
		await teamAllocations.setToken(token.address);
		await teamAllocations.setAdmin(admin);

		advisorsAllocations = await AllocationsManager.new();
		await advisorsAllocations.setToken(token.address);
		await advisorsAllocations.setAdmin(admin);
		config = await SaleConfiguration.new();
	});


	it('should deploy crowdsale and connect to token and allocations contracts', async function() {
		crowdsale = await AkropolisCrowdsale.new(startTime, endTime, wallet, whitelist.address, config.address).should.be.fulfilled;
		await crowdsale.setAdmin(admin);
		await token.transferOwnership(crowdsale.address).should.be.fulfilled;
		await crowdsale.setToken(token.address).should.be.fulfilled;
		await crowdsale.setBaseCap(ether(3), {from: owner}).should.be.fulfilled;
		await crowdsale.setMaxCap(ether(10), {from: owner}).should.be.fulfilled;
		await crowdsale.setRoundDuration(duration.days(1), {from: owner}).should.be.fulfilled;
	});


	it('should should not sell tokens before start of round 1', async function() {
		await crowdsale.buyTokens(buyer1, {from: buyer1, value: CONTRIBUTION_AMOUNT}).should.be.rejectedWith('revert');
	});


	it('should sell tokens to whitelisted users during round 1', async function() {
		tokenBuyerAmount = (await config.AET_RATE()).mul(CONTRIBUTION_AMOUNT);
		await increaseTimeTo(startTime);
		(await crowdsale.getCurrentRound()).should.be.bignumber.equal(1);
		await crowdsale.buyTokens(buyer1, {from: buyer1, value: CONTRIBUTION_AMOUNT}).should.be.fulfilled;

		let tokenBuyerAmountRound1 = tokenBuyerAmount.mul(1.2);
		(await token.balanceOf(buyer1)).should.be.bignumber.equal(tokenBuyerAmountRound1);
	});


	it('should sell tokens to whitelisted users during round 2', async function() {
		await increaseTimeTo(startTime + duration.days(1));
		(await crowdsale.getCurrentRound()).should.be.bignumber.equal(2);
		await crowdsale.buyTokens(buyer2, {from: buyer2, value: CONTRIBUTION_AMOUNT}).should.be.fulfilled;

		let tokenBuyerAmountRound2 = tokenBuyerAmount.mul(1.1);
		(await token.balanceOf(buyer2)).should.be.bignumber.equal(tokenBuyerAmountRound2);
	});


	it('should sell tokens to whitelisted users during round 3', async function() {
		await increaseTimeTo(startTime + duration.days(2));
		(await crowdsale.getCurrentRound()).should.be.bignumber.equal(3);
		await crowdsale.buyTokens(buyer3, {from: buyer3, value: CONTRIBUTION_AMOUNT}).should.be.fulfilled;

		let tokenBuyerAmountRound3 = tokenBuyerAmount.mul(1.05);
		(await token.balanceOf(buyer3)).should.be.bignumber.equal(tokenBuyerAmountRound3);
	});


	it('should sell tokens to whitelisted users during round 4', async function() {
		await increaseTimeTo(startTime + duration.days(3));
		(await crowdsale.getCurrentRound()).should.be.bignumber.equal(4);
		await crowdsale.buyTokens(buyer4, {from: buyer4, value: CONTRIBUTION_AMOUNT}).should.be.fulfilled;

		(await token.balanceOf(buyer4)).should.be.bignumber.equal(tokenBuyerAmount);
	});


	it('should not allow for transfer of tokens', async function () {
		await token.transfer(unknown, 1, {from: buyer1}).should.be.rejectedWith('revert');
		await token.approve(unknown, 1, {from: buyer1}).should.be.rejectedWith('revert');
		await token.transferFrom(buyer1, unknown, 1, {from: unknown}).should.be.rejectedWith('revert');
	});


	it('should finalize crowdsale', async function() {
		await increaseTimeTo(afterEndTime);
		await crowdsale.setPresaleAllocations(presaleAllocations.address, {from: owner});
		await crowdsale.setTeamAllocations(teamAllocations.address, {from: owner});
		await crowdsale.setAdvisorsAllocations(advisorsAllocations.address, {from: owner});

		await crowdsale.setReserveFund(reserveFund, {from: owner});
		await crowdsale.setBountyFund(bountyFund, {from: owner});
		await crowdsale.setDevelopmentFund(developmentFund, {from: owner});

		await crowdsale.finalize({from: owner}).should.be.fulfilled;

		//Test reserve fund
		let sold = await crowdsale.tokensSold();
		let supply = await config.PUBLIC_SALE_SUPPLY();
		let unsold = supply.sub(sold);
		(await token.balanceOf(reserveFund)).should.be.bignumber.equal((await config.RESERVE_FUND_VALUE()).add(unsold));
	});


	it('should should not sell tokens after the crowdsale has been finalized', async function() {
		await crowdsale.buyTokens(buyer1, {from: buyer1, value: CONTRIBUTION_AMOUNT}).should.be.rejectedWith('revert');
	});
});